import type {Logger} from '@subsquid/logger'
import {assertNotNull, last} from '@subsquid/util-internal'
import assert from 'assert'
import {applyRangeBound, BatchRequest, getBlocksCount} from './batch'
import {Database, HashAndHeight, HotDatabaseState} from './database'
import {
    ArchiveDataSource,
    ArchiveIngest,
    BaseBlock,
    BatchResponse,
    HotDataSource,
    DataBatch,
    HotIngest
} from './ingest'
import {Metrics} from './metrics'
import {rangeEnd} from './range'
import {getItemsCount, timeInterval} from './util'


export interface RunnerConfig<R, B, S> {
    archive?: ArchiveDataSource<R, B>
    archivePollInterval?: number
    hotDataSource?: HotDataSource<R, B>
    hotDataSourcePollInterval?: number
    requests: BatchRequest<R>[]
    database: Database<S>
    log: Logger
    metrics: Metrics
    prometheusPort?: number | string
}


export class Runner<R, B extends BaseBlock, S> {
    private chainHeight = -1
    private lastBlock = -1

    constructor(protected config: RunnerConfig<R, B, S>) {}

    async run(): Promise<void> {
        let log = this.config.log

        let state = await this.getDatabaseState()
        if (state.height >= 0) {
            log.info(`last processed final block was ${state.height}`)
            this.setLastProcessedBlock(state.height)
        }

        let requests = applyRangeBound(this.config.requests, {from: state.height + 1})
        if (requests.length == 0) {
            this.printProcessingRange()
            log.info('nothing to do')
            return
        }

        this.printProcessingMessage(requests)

        let prometheusServer = await this.config.metrics.serve(this.getPrometheusPort())
        log.info(`prometheus metrics are served at port ${prometheusServer.port}`)

        const archive = this.config.archive
        const hot = this.config.hotDataSource

        if (archive) {
            let archiveHeight = await archive.getFinalizedHeight()
            if (archiveHeight > state.height + state.top.length || hot == null) {
                requests = await this.processFinalizedBlocks({
                    src: archive,
                    srcHeight: archiveHeight,
                    srcPollInterval: this.config.archivePollInterval,
                    requests,
                    minimumCommitHeight: state.height + state.top.length,
                    shouldStopOnHeight: hot && (async height => {
                        let h = await hot.getFinalizedHeight()
                        return h > height && h - height < 10000
                    })
                })
                if (requests.length == 0) return
                state = {height: requests[0].range.from - 1, top: []}
            }
        }

        assert(hot)

        let chainFinalizedHeight = await hot.getFinalizedHeight()
        if (chainFinalizedHeight > state.height + state.top.length) {
            requests = await this.processFinalizedBlocks({
                src: hot,
                srcHeight: chainFinalizedHeight,
                srcPollInterval: this.config.hotDataSourcePollInterval,
                requests,
                minimumCommitHeight: state.height + state.top.length,
                shouldStopOnHeight: async height => !!this.config.database.supportsHotBlocks
            })
            if (requests.length == 0) return
            state = {height: requests[0].range.from - 1, top: []}
        }

        return this.processHotBlocks(requests, state.height, state.top)
    }

    private async processFinalizedBlocks(options: {
        requests: BatchRequest<R>[]
        src: ArchiveDataSource<R, B>
        srcHeight: number
        srcPollInterval?: number
        minimumCommitHeight?: number
        shouldStopOnHeight?: (height: number) => Promise<boolean>
    }): Promise<BatchRequest<R>[]> {
        this.setChainHeight(options.srcHeight)
        this.updateProgress()

        let ingest = new ArchiveIngest({
            requests: options.requests,
            archive: options.src,
            pollInterval: options.srcPollInterval
        })

        if (options.shouldStopOnHeight) {
            ingest.shouldStopOnHeight = options.shouldStopOnHeight
        }

        let prevBatch: DataBatch<B> | undefined

        for await (let batch of ingest.getBlocks()) {
            if (prevBatch) {
                batch = {
                    range: {from: prevBatch.range.from, to: batch.range.to},
                    chainHeight: batch.chainHeight,
                    blocks: prevBatch.blocks.concat(batch.blocks),
                    fetchStartTime: prevBatch.fetchStartTime,
                    fetchEndTime: batch.fetchEndTime
                }
            }
            if (options.minimumCommitHeight && batch.range.to < options.minimumCommitHeight) {
                prevBatch = batch
            } else {
                prevBatch = undefined
                await this.handleBatch(batch)
            }
        }

        if (prevBatch) {
            await this.handleBatch(prevBatch)
        }

        return ingest.getLeftRequests()
    }

    private async processHotBlocks(
        requests: BatchRequest<R>[],
        finalizedHeight: number,
        head: HashAndHeight[]
    ): Promise<void> {
        this.setChainHeight(finalizedHeight + head.length)
        this.updateProgress()

        let src = assertNotNull(this.config.hotDataSource)

        assert(finalizedHeight > 0)

        let finalizedTop = {
            height: finalizedHeight,
            hash: await src.getBlockHash(finalizedHeight)
        }

        let ingest = new HotIngest({
            src,
            finalizedHead: finalizedTop,
            top: head,
            requests,
            pollInterval: this.config.hotDataSourcePollInterval
        })

        for await (let batch of ingest.getItems()) {
            await this.handleBatch(batch)
        }
    }

    private getDatabaseState(): Promise<HotDatabaseState> {
        if (this.config.database.supportsHotBlocks) {
            return this.config.database.connect()
        } else {
            return this.config.database.connect().then(({height}) => {
                return {height, top: []}
            })
        }
    }

    private async handleBatch(batch: DataBatch<B>): Promise<void> {
        this.setChainHeight(batch.chainHeight)

        let mappingStartTime = process.hrtime.bigint()

        if (batch.finalizedHead) {
            assert(this.config.database.supportsHotBlocks)
            await this.config.database.transactHot({
                finalizedHead: batch.finalizedHead,
                blocks: batch.blocks
            }, (store, block) => {
                return this.processBatch(store, {
                    range: {from: block.header.height, to: block.header.height},
                    blocks: [block],
                    chainHeight: batch.chainHeight
                })
            })
        } else {
            await this.config.database.transact({
                from: batch.range.from,
                to: batch.range.to,
                isHead: batch.range.to === batch.chainHeight
            }, store => this.processBatch(store, batch))
        }

        let mappingEndTime = process.hrtime.bigint()

        this.setLastProcessedBlock(batch.range.to)
        this.updateProgress(mappingEndTime)
        this.config.metrics.registerBatch(
            batch.blocks.length,
            getItemsCount(batch.blocks),
            batch.fetchStartTime,
            batch.fetchEndTime,
            mappingStartTime,
            mappingEndTime
        )
        this.config.log.info(
            `${this.lastBlock} / ${this.config.metrics.getChainHeight()}, ` +
            `rate: ${Math.round(this.config.metrics.getSyncSpeed())} blocks/sec, ` +
            `mapping: ${Math.round(this.config.metrics.getMappingSpeed())} blocks/sec, ` +
            `${Math.round(this.config.metrics.getMappingItemSpeed())} items/sec, ` +
            `ingest: ${Math.round(this.config.metrics.getIngestSpeed())} blocks/sec, ` +
            `eta: ${timeInterval(this.config.metrics.getSyncEtaSeconds())}`
        )
    }

    async processBatch(store: S, batch: BatchResponse<B>): Promise<void> {}

    private getEstimatedTotalBlocksCount(): number {
        return getBlocksCount(this.config.requests, 0,  this.chainHeight)
    }

    private getEstimatedBlocksLeft(): number {
        return getBlocksCount(this.config.requests, this.lastBlock + 1, this.chainHeight)
    }

    private setChainHeight(height: number): void {
        this.chainHeight = height
        this.config.metrics.setChainHeight(height)
    }

    private setLastProcessedBlock(blockNumber: number): void {
        this.lastBlock = blockNumber
        this.config.metrics.setLastProcessedBlock(blockNumber)
    }

    private updateProgress(time?: bigint): void {
        this.config.metrics.updateProgress(
            this.chainHeight,
            this.getEstimatedTotalBlocksCount(),
            this.getEstimatedBlocksLeft(),
            time
        )
    }

    private getPrometheusPort(): number | string {
        let port = this.config.prometheusPort
        return port == null
            ? process.env.PROCESSOR_PROMETHEUS_PORT || process.env.PROMETHEUS_PORT || 0
            : port
    }

    private printProcessingRange(): void {
        if (this.config.requests.length == 0) return
        let requests = this.config.requests
        this.config.log.info(`processing range is [${requests[0].range.from}, ${last(requests).range.to}]`)
    }

    private printProcessingMessage(requests: BatchRequest<R>[]): void {
        let from = requests[0].range.from
        let end = rangeEnd(last(requests).range)
        let msg = `processing blocks from ${from}`
        if (Number.isSafeInteger(end)) {
            msg += ' to ' + end
        }
        this.config.log.info(msg)
    }
}

