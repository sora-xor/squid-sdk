import type {Logger} from '@subsquid/logger'
import {assertNotNull, def, last, maybeLast} from '@subsquid/util-internal'
import assert from 'assert'
import {applyRangeBound, BatchRequest} from './batch'
import {Database, HashAndHeight, HotDatabaseState} from './database'
import {ArchiveDataSource, ArchiveIngest, BaseBlock, BatchResponse, DataBatch, HotDataSource, HotIngest} from './ingest'
import {PrometheusServer} from './prometheus'
import {rangeEnd} from './range'
import {RunnerMetrics} from './runner-metrics'
import {getItemsCount} from './util'


export interface RunnerConfig<R, B, S> {
    archive?: ArchiveDataSource<R, B>
    archivePollInterval?: number
    hotDataSource?: HotDataSource<R, B>
    hotDataSourcePollInterval?: number
    requests: BatchRequest<R>[]
    database: Database<S>
    log: Logger
    prometheus: PrometheusServer
}


export class Runner<R, B extends BaseBlock, S> {
    private metrics: RunnerMetrics

    constructor(protected config: RunnerConfig<R, B, S>) {
        this.metrics = new RunnerMetrics(this.config.requests)
    }

    async run(): Promise<void> {
        let log = this.config.log

        let state = await this.getDatabaseState()
        if (state.height >= 0) {
            log.info(`last processed final block was ${state.height}`)
        }

        if (this.getLeftRequests(state).length == 0) {
            this.printProcessingRange()
            log.info('nothing to do')
            return
        }

        this.printProcessingMessage(state)

        const archive = this.config.archive
        const hot = this.config.hotDataSource

        if (archive) {
            let archiveHeight = await archive.getFinalizedHeight()
            if (archiveHeight > state.height + state.top.length || hot == null) {
                await this.initMetrics(archiveHeight, state)
                state = await this.processFinalizedBlocks({
                    state,
                    src: archive,
                    srcPollInterval: this.config.archivePollInterval,
                    shouldStopOnHeight: hot && (async height => {
                        let h = await hot.getFinalizedHeight()
                        return h > height
                    })
                })
                if (this.getLeftRequests(state).length == 0) return
            }
        }

        assert(hot)

        let chainFinalizedHeight = await hot.getFinalizedHeight()
        await this.initMetrics(chainFinalizedHeight, state)
        if (chainFinalizedHeight > state.height + state.top.length) {
            state = await this.processFinalizedBlocks({
                state,
                src: hot,
                srcPollInterval: this.config.hotDataSourcePollInterval,
                shouldStopOnHeight: async height => !!this.config.database.supportsHotBlocks
            })
            if (this.getLeftRequests(state).length == 0) return
        }

        return this.processHotBlocks(state)
    }

    private async processFinalizedBlocks(options: {
        state: HotDatabaseState,
        src: ArchiveDataSource<R, B>
        srcPollInterval?: number
        shouldStopOnHeight?: (height: number) => Promise<boolean>
    }): Promise<HotDatabaseState> {

        let state = options.state

        let ingest = new ArchiveIngest({
            requests: this.getLeftRequests(state),
            archive: options.src,
            pollInterval: options.srcPollInterval
        })

        if (options.shouldStopOnHeight) {
            ingest.shouldStopOnHeight = options.shouldStopOnHeight
        }

        let minimumCommitHeight = state.height + state.top.length
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
            if (batch.range.to < minimumCommitHeight) {
                prevBatch = batch
            } else {
                prevBatch = undefined
                state = await this.handleFinalizedBlocks(state, batch)
            }
        }

        if (prevBatch) {
            state = await this.handleFinalizedBlocks(state, prevBatch)
        }

        return state
    }

    private async handleFinalizedBlocks(state: HotDatabaseState, batch: DataBatch<B>): Promise<HotDatabaseState> {
        assert(state.height < batch.range.from)

        let lastBlock = maybeLast(batch.blocks)
        if (lastBlock?.header.height !== batch.range.to) {
            this.log.warn(
                {batchRange: batch.range},
                'by convention batch always should contain the last block of its range'
            )
        }
        if (lastBlock == null) return state

        let nextState: HotDatabaseState = {
            height: lastBlock.header.height,
            hash: lastBlock.header.hash,
            top: []
        }

        await this.withProgressMetrics(batch, () => {
            return this.config.database.transact({
                prevHead: state,
                nextHead: nextState,
                isOnTop: batch.chainHeight === batch.range.to
            }, store => {
                return this.processBatch(store, batch)
            })
        })

        return nextState
    }

    private async processHotBlocks(state: HotDatabaseState): Promise<void> {
        assert(this.config.database.supportsHotBlocks === true)
        let db = this.config.database

        let ingest = new HotIngest({
            src: assertNotNull(this.config.hotDataSource),
            state,
            requests: this.getLeftRequests(state),
            pollInterval: this.config.hotDataSourcePollInterval
        })

        for await (let batch of ingest.getItems()) {
            await this.withProgressMetrics(batch, () => {
                return db.transactHot({
                    finalizedHead: batch.finalizedHead,
                    baseHead: batch.baseHead,
                    newBlocks: batch.blocks.map(b => b.header)
                }, (store, ref) => {
                    let idx = ref.height - batch.baseHead.height - 1
                    let block = batch.blocks[idx]
                    assert.strictEqual(block.header.hash, ref.hash)
                    assert.strictEqual(block.header.height, ref.height)

                    return this.processBatch(store, {
                        range: {from: ref.height, to: ref.height},
                        blocks: [block],
                        chainHeight: batch.chainHeight
                    })
                })
            })
        }
    }

    async processBatch(store: S, batch: BatchResponse<B>): Promise<void> {}

    private async withProgressMetrics<R>(batch: DataBatch<B>, handler: () => R): Promise<R> {
        this.metrics.setChainHeight(batch.chainHeight)

        let mappingStartTime = process.hrtime.bigint()

        let result = await handler()

        let mappingEndTime = process.hrtime.bigint()

        this.metrics.setLastProcessedBlock(batch.range.to)
        this.metrics.updateProgress(mappingEndTime)
        this.metrics.registerBatch(
            batch.blocks.length,
            getItemsCount(batch.blocks),
            batch.fetchStartTime,
            batch.fetchEndTime,
            mappingStartTime,
            mappingEndTime
        )
        this.log.info(this.metrics.getStatusLine())
        return result
    }

    private async initMetrics(chainHeight: number, state: HotDatabaseState): Promise<void> {
        if (this.metrics.getChainHeight() >= 0) return
        this.metrics.setChainHeight(chainHeight)
        this.metrics.setLastProcessedBlock(state.height + state.top.length)
        this.metrics.updateProgress()
        return this.startPrometheusServer()
    }

    private getLeftRequests(after: HashAndHeight): BatchRequest<R>[] {
        return applyRangeBound(this.config.requests, {from: after.height + 1})
    }

    private getDatabaseState(): Promise<HotDatabaseState> {
        if (this.config.database.supportsHotBlocks) {
            return this.config.database.connect()
        } else {
            return this.config.database.connect().then(head => {
                return {...head, top: []}
            })
        }
    }

    private printProcessingRange(): void {
        if (this.config.requests.length == 0) return
        let requests = this.config.requests
        this.log.info(`processing range is [${requests[0].range.from}, ${last(requests).range.to}]`)
    }

    private printProcessingMessage(state: HashAndHeight): void {
        let from = state.height + 1
        let end = rangeEnd(last(this.config.requests).range)
        let msg = `processing blocks from ${from}`
        if (Number.isSafeInteger(end)) {
            msg += ' to ' + end
        }
        this.log.info(msg)
    }

    @def
    private async startPrometheusServer(): Promise<void> {
        let prometheusServer = await this.config.prometheus.serve()
        this.log.info(`prometheus metrics are served at port ${prometheusServer.port}`)
    }

    private get log(): Logger {
        return this.config.log
    }
}
