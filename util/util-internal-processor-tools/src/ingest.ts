import {def, last, maybeLast, wait} from '@subsquid/util-internal'
import assert from 'assert'
import {BatchRequest} from './batch'
import {rangeEnd} from './range'


export interface HashAndHeight {
    hash: string
    height: number
}


export interface BaseBlockHeader {
    height: number
    hash: string
    parentHash: string
}


export interface BaseBlock {
    header: BaseBlockHeader
    items: object[]
}


export interface BatchResponse<B> {
    /**
     * This is the range of scanned blocks
     */
    range: {from: number, to: number}
    blocks: B[]
    chainHeight: number
}


export interface DataBatch<B> extends BatchResponse<B> {
    fetchStartTime: bigint
    fetchEndTime: bigint
    finalizedTop?: HashAndHeight
}


export interface HotDataBatch<B> extends DataBatch<B> {
    finalizedTop: HashAndHeight
}


export interface ArchiveDataSource<R, B> {
    getFinalizedBatch(request: BatchRequest<R>): Promise<BatchResponse<B>>
    getFinalizedHeight(): Promise<number>
}


export interface ChainDataSource<R, B> extends ArchiveDataSource<R, B> {
    getBlock(blockHash: string, request?: R): Promise<B>
    getBlockHash(height: number): Promise<string>
    getBestHead(): Promise<HashAndHeight>
    getFinalizedHead(): Promise<HashAndHeight>
}


export interface ArchiveIngestOptions<R, B> {
    requests: BatchRequest<R>[]
    archive: ArchiveDataSource<R, B>
    pollInterval?: number
    maxBufferedBatches?: number
}


export class ArchiveIngest<R, B extends BaseBlock> {
    private requests: BatchRequest<R>[]
    private src: ArchiveDataSource<R, B>
    private pollInterval: number
    private queue: Promise<DataBatch<B> | null>[] = []
    private chainHeight = -1
    private fetching = false
    private maxBufferedBatches: number

    constructor(options: ArchiveIngestOptions<R, B>) {
        this.requests = options.requests.slice()
        this.src = options.archive
        this.pollInterval = options.pollInterval ?? 2000
        this.maxBufferedBatches = options.maxBufferedBatches ?? 2
    }

    getLeftRequests(): BatchRequest<R>[] {
        return this.requests.slice()
    }

    async shouldStopOnHeight(height: number): Promise<boolean> {
        return false
    }

    @def
    async *getBlocks(): AsyncIterable<DataBatch<B>> {
        this.chainHeight = await this.src.getFinalizedHeight()
        while (true) {
            if (!this.fetching) {
                this.loop()
            }
            let batch = await this.queue.shift()
            if (batch == null) return
            yield batch
        }
    }

    private loop() {
        if (this.queue.length >= this.maxBufferedBatches) {
            this.fetching = false
            return
        } else {
            this.fetching = true
        }

        if (this.requests.length == 0) return

        let req = this.requests[0]

        let promise: Promise<DataBatch<B> | null> = this.waitForHeight(req.range.from).then(async ok => {
            if (!ok) return null

            let fetchStartTime = process.hrtime.bigint()
            let response = await this.src.getFinalizedBatch(req)
            let fetchEndTime = process.hrtime.bigint()

            assert(response.range.from <= response.range.to)
            assert(response.range.from == req.range.from)
            assert(response.range.to <= rangeEnd(req.range))

            let blocks = response.blocks.sort((a, b) => a.header.height - b.header.height)
            if (blocks.length) {
                assert(response.range.from <= blocks[0].header.height)
                assert(response.range.to >= last(blocks).header.height)
            }

            this.chainHeight = Math.max(this.chainHeight, response.chainHeight)

            if (response.range.to < rangeEnd(req.range)) {
                this.requests[0] = {
                    range: {from: response.range.to + 1, to: req.range.to},
                    request: req.request
                }
            } else {
                this.requests.shift()
            }

            this.loop()

            return {
                ...response,
                fetchStartTime,
                fetchEndTime,
                chainHeight: this.chainHeight
            }
        })

        promise.catch(() => {})

        this.queue.push(promise)
    }

    private async waitForHeight(minimumHeight: number): Promise<boolean> {
        while (this.chainHeight < minimumHeight) {
            if (await this.shouldStopOnHeight(this.chainHeight)) return false
            await wait(this.pollInterval)
            this.chainHeight = Math.max(this.chainHeight, await this.src.getFinalizedHeight())
        }
        return true
    }
}


export interface HotIngestOptions<R, B> {
    src: ChainDataSource<R, B>
    finalizedTop: HashAndHeight
    head: HashAndHeight[]
    requests: BatchRequest<R>[]
    pollInterval?: number
}


export class HotIngest<R, B extends BaseBlock> {
    private requests: BatchRequest<R>[]
    private finalizedTop: HashAndHeight
    private head: HashAndHeight[]
    private src: ChainDataSource<R, B>
    private pollInterval: number

    constructor(options: HotIngestOptions<R, B>) {
        this.requests = options.requests
        this.finalizedTop = options.finalizedTop
        this.head = options.head.slice()
        this.src = options.src
        this.pollInterval = options.pollInterval ?? 1000
        this.assertInvariants()
    }

    private assertInvariants(): void {
        if (this.head.length > 0) {
            assert(this.head[0].height == this.finalizedTop.height + 1)
            for (let i = 1; i < this.head.length; i++) {
                assert(this.head[i].height == this.head[i-1].height + 1)
            }
        }
    }

    private waitsForBlocks(): boolean {
        let next = this.finalizedTop.height + 1
        for (let req of this.requests) {
            let to = req.range.to ?? Infinity
            if (next <= to) return true
        }
        return false
    }

    private getRequestAtHeight(height: number): R | undefined {
        for (let req of this.requests) {
            let from = req.range.from
            let to = req.range.to ?? Infinity
            if (from <= height && height <= to) return req.request
        }
    }

    @def
    async *getItems(): AsyncIterable<HotDataBatch<B>> {
        while (this.waitsForBlocks()) {
            let fetchStartTime = process.hrtime.bigint()
            let finalizedTop = await this.src.getFinalizedHead()
            let best = await this.src.getBestHead()

            assert(this.finalizedTop.height <= finalizedTop.height)
            assert(finalizedTop.height <= best.height)

            let chain: B[] = []
            let top = maybeLast(this.head) ?? this.finalizedTop

            while (top.height < best.height) {
                let item = await this.getBlock(best)
                chain.push(item.block)
                best = item.parent
            }

            while (top.hash !== best.hash) {
                assert(this.head.length)
                this.head.pop()
                top = maybeLast(this.head) ?? this.finalizedTop

                let item = await this.getBlock(best)
                chain.push(item.block)
                best = item.parent
            }

            let fetchEndTime = process.hrtime.bigint()

            chain = chain.reverse()
            for (let block of chain) {
                this.head.push(block.header)
            }

            if (finalizedTop.height == this.finalizedTop.height) {
                assert(finalizedTop.hash === this.finalizedTop.hash)
            } else {
                assert(this.head.length)
                assert(this.head[0].height <= finalizedTop.height)
                assert(last(this.head).height >= finalizedTop.height)
                while (this.head[0].height < finalizedTop.height) {
                    this.head.shift()
                }
                assert(this.head[0].hash === finalizedTop.hash)
                this.head.shift()
                this.finalizedTop = finalizedTop
            }

            if (chain.length) {
                yield {
                    range: {from: chain[0].header.height, to: last(chain).header.height},
                    blocks: chain,
                    chainHeight: last(chain).header.height,
                    fetchStartTime,
                    fetchEndTime,
                    finalizedTop
                }
            }

            let sinceLastPoll = Number(process.hrtime.bigint() - fetchStartTime) / 1_000_000
            await wait(Math.max(0, this.pollInterval - sinceLastPoll))
        }
    }

    private async getBlock(ref: HashAndHeight): Promise<{block: B, parent: HashAndHeight}> {
        let request = this.getRequestAtHeight(ref.height)
        let block = await this.src.getBlock(ref.hash, request)
        return {
            block,
            parent: {
                hash: block.header.parentHash,
                height: block.header.height - 1
            }
        }
    }
}
