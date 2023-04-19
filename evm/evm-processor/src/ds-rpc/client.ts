import {addErrorContext, groupBy} from '@subsquid/util-internal'
import {BatchRequest, BatchResponse, HashAndHeight, HotDataSource} from '@subsquid/util-internal-processor-tools'
import {RpcClient} from '@subsquid/util-internal-resilient-rpc'
import assert from 'assert'
import {DataRequest, FullBlockData, FullLogItem} from '../interfaces/data'
import {EvmBlock, EvmLog, EvmTransaction, Qty} from '../interfaces/evm'
import {blockItemOrder, formatId} from '../util'
import * as rpc from './rpc'


export interface EvmRpcDataSourceOptions {
    rpc: RpcClient
    blockBatchSize?: number
    finalityConfirmation?: number
}


export class EvmRpcDataSource implements HotDataSource<DataRequest, FullBlockData> {
    private rpc: RpcClient
    private batchSize: number
    private finalityConfirmation: number
    private lastFinalizedHeight = 0
    private lastFinalizedHead?: HashAndHeight
    private lastBlock?: rpc.Block

    constructor(options: EvmRpcDataSourceOptions) {
        this.rpc = options.rpc
        this.batchSize = options.blockBatchSize || 10
        this.finalityConfirmation = options.finalityConfirmation ?? 10
    }

    async getFinalizedBatch(request: BatchRequest<DataRequest>): Promise<BatchResponse<FullBlockData>> {
        let firstBlock = request.range.from
        let lastBlock = Math.min(request.range.to ?? Infinity, firstBlock + this.batchSize)

        assert(firstBlock <= lastBlock)

        let height = this.lastFinalizedHeight
        if (height < lastBlock) {
            height = await this.getFinalizedHeight()
        }

        assert(firstBlock <= height, 'requested blocks from non-finalized range')
        lastBlock = Math.min(height, lastBlock)

        let needsTransactions = transactionsRequested(request.request)
        let needsReceipts = receiptsRequested(request.request)
        let needsLogs = logsRequested(request.request)

        let blockPromises: Promise<rpc.Block>[] = []
        for (let i = firstBlock; i <= lastBlock; i++) {
            blockPromises.push(
                this.rpc.call(i, 'eth_getBlockByNumber', ['0x'+i.toString(16), needsTransactions])
            )
        }

        let batchBlocks: FullBlockData[]
        if (needsReceipts) {
            batchBlocks = await Promise.all(
                blockPromises.map(p => p.then(
                    block => this.mapBlockWithReceipts(block, needsLogs).catch(err => {
                        throw addBlockContext(err, block)
                    })
                ))
            )
        } else {
            let [blocks, logs] = await Promise.all([
                Promise.all(blockPromises),
                needsLogs ? this.fetchLogs(firstBlock, lastBlock) : Promise.resolve([])
            ])

            let logsByBlockHash = groupBy(logs, (log: rpc.Log) => log.blockHash)

            batchBlocks = blocks.map(block => {
                let logs = logsByBlockHash.get(block.hash) ?? []
                logsByBlockHash.delete(block.hash)
                try {
                    return mapBlock(block, logs)
                } catch(e: any) {
                    throw addBlockContext(e, block)
                }
            })

            assert(logsByBlockHash.size == 0, `got logs from unexpected blocks in range [${firstBlock}, ${lastBlock}]`)
        }

        assertBlockChain(batchBlocks)

        return {
            range: {from: firstBlock, to: lastBlock},
            blocks: batchBlocks,
            chainHeight: height
        }
    }

    private fetchLogs(firstBlock: number, lastBlock: number): Promise<rpc.Log[]> {
        return this.rpc.call('eth_getLogs', [{
            fromBlock: '0x'+firstBlock.toString(16),
            toBlock: '0x'+lastBlock.toString(16)
        }])
    }

    private async mapBlockWithReceipts(block: rpc.Block, needsLogs: boolean): Promise<FullBlockData> {
        let logs: rpc.Log[] = []
        let blockHeight = qty2Int(block.number)

        let receipts = await Promise.all(block.transactions.map(tx => {
            assert(typeof tx == 'object')
            return this.rpc.call<rpc.TransactionReceipt>(blockHeight, 'eth_getTransactionReceipt', [tx.hash])
        }))

        for (let i = 0; i < block.transactions.length; i++) {
            let tx = block.transactions[i]
            let receipt = receipts[i]
            assert(typeof tx == 'object')
            assert(receipt.transactionHash === tx.hash)
            tx.receipt = receipt
            if (needsLogs) {
                logs.push(...receipt.logs)
            }
        }

        return mapBlock(block, logs)
    }

    async getFinalizedHeight(): Promise<number> {
        let height = await this.getHeight()
        return this.lastFinalizedHeight = Math.max(0, height - this.finalityConfirmation)
    }

    private async getHeight(): Promise<number> {
        let qty: Qty = await this.rpc.call('eth_blockNumber')
        let height = parseInt(qty)
        assert(Number.isSafeInteger(height))
        return height
    }

    async getFinalizedHead(): Promise<HashAndHeight> {
        let height = await this.getFinalizedHeight()
        if (this.lastFinalizedHead?.height === height) return this.lastFinalizedHead
        let block: rpc.Block = await this.rpc.call('eth_getBlockByNumber', ['0x'+height.toString(16), false])
        return this.lastFinalizedHead = {
            hash: block.hash,
            height: qty2Int(block.number)
        }
    }

    async getBestHead(): Promise<HashAndHeight> {
        this.lastBlock = await this.rpc.call('eth_getBlockByNumber', ['latest', true])
        return {
            height: qty2Int(this.lastBlock.number),
            hash: this.lastBlock.hash
        }
    }

    async getBlock(blockHash: string, request?: DataRequest): Promise<FullBlockData> {
        let block: rpc.Block
        if (this.lastBlock?.hash === blockHash) {
            block = this.lastBlock
        } else {
            block = await this.rpc.call('eth_getBlockByHash', [blockHash, transactionsRequested(request)])
        }
        try {
            if (receiptsRequested(request)) {
                return await this.mapBlockWithReceipts(block, logsRequested(request))
            } else if (logsRequested(request)) {
                let height = qty2Int(block.number)
                let logs: rpc.Log[] = await this.fetchLogs(height, height)
                for (let log of logs) {
                    assert.strictEqual(log.blockHash, block.hash)
                }
                return mapBlock(block, logs)
            } else {
                return mapBlock(block, [])
            }
        } catch(err: any) {
            throw addBlockContext(err, block)
        }
    }

    async getBlockHash(height: number): Promise<string> {
        let block: rpc.Block = await this.rpc.call('eth_getBlockByNumber', ['0x'+height.toString(16), false])
        return block.hash
    }
}


function mapBlock(block: rpc.Block, logs: rpc.Log[]): FullBlockData {
    let header = mapBlockHeader(block)
    let items: FullBlockData['items'] = []
    let txIndex = new Map<EvmTransaction['transactionIndex'], EvmTransaction>()

    for (let rpcTx of block.transactions) {
        if (typeof rpcTx != 'object') {
            break
        }
        let transaction = mapTransaction(rpcTx)
        txIndex.set(transaction.transactionIndex, transaction)
        items.push({kind: 'transaction', transaction})
    }

    for (let rpcLog of logs) {
        let log = mapLog(rpcLog)
        let transaction = txIndex.get(log.transactionIndex)
        let item: Partial<FullLogItem> = {
            kind: 'log',
            log,
        }
        if (transaction) {
            item.transaction = transaction
        }
        items.push(item as FullLogItem)
    }

    items.sort(blockItemOrder)

    return {header, items}
}


function mapBlockHeader(block: rpc.Block): EvmBlock {
    let height = qty2Int(block.number)
    return {
        id: formatId(height, block.hash),
        height,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: qty2Int(block.timestamp),
        stateRoot: block.stateRoot,
        transactionsRoot: block.transactionsRoot,
        receiptsRoot: block.receiptsRoot,
        logsBloom: block.logsBloom,
        extraData: block.extraData,
        sha3Uncles: block.sha3Uncles,
        miner: block.miner,
        nonce: block.nonce,
        size: BigInt(block.size),
        gasLimit: BigInt(block.gasLimit),
        gasUsed: BigInt(block.gasUsed),
        difficulty: BigInt(block.difficulty)
    }
}


function mapTransaction(src: rpc.Transaction): EvmTransaction {
    let transactionIndex = qty2Int(src.transactionIndex)
    let tx: EvmTransaction = {
        id: formatId(qty2Int(src.blockNumber), src.blockHash, transactionIndex),
        transactionIndex,
        hash: src.hash,
        from: src.from,
        to: src.to || undefined,
        input: src.input,
        nonce: qty2Int(src.nonce),
        v: BigInt(src.v),
        r: src.r,
        s: src.s,
        value: BigInt(src.value),
        gas: BigInt(src.gas),
        gasPrice: BigInt(src.gasPrice),
        sighash: src.input.slice(0, 10)
    }
    if (src.receipt) {
        tx.gasUsed = BigInt(src.receipt.gasUsed)
        tx.cumulativeGasUsed = BigInt(src.receipt.cumulativeGasUsed)
        tx.effectiveGasPrice = BigInt(src.receipt.effectiveGasPrice)
        tx.type = qty2Int(src.receipt.type)
        tx.status = qty2Int(src.receipt.status)
    }
    return tx
}


function mapLog(log: rpc.Log): EvmLog {
    let logIndex = qty2Int(log.logIndex)
    return {
        id: formatId(qty2Int(log.blockNumber), log.blockHash, logIndex),
        logIndex,
        transactionIndex: qty2Int(log.transactionIndex),
        address: log.address,
        topics: log.topics,
        data: log.data
    }
}


function assertBlockChain(blocks: FullBlockData[]): void {
    if (blocks.length == 0) return
    for (let i = 1; i < blocks.length; i++) {
        assert.strictEqual(blocks[i-1].header.hash, blocks[i].header.parentHash)
        assert.strictEqual(blocks[i-1].header.height + 1, blocks[i].header.height)
    }
}


function addBlockContext(err: Error, block: rpc.Block): Error {
    let ctx: any = {
        blockHash: block.hash
    }
    try {
        ctx.blockHeight = qty2Int(block.number)
    } catch(e: any) {
        ctx.blockNumber = block.number
    }
    return addErrorContext(err, ctx)
}


function qty2Int(qty: Qty): number {
    let i = parseInt(qty, 16)
    assert(Number.isSafeInteger(i))
    return i
}


function logsRequested(req?: DataRequest): boolean {
    return !!req?.logs?.length
}


function transactionsRequested(req?: DataRequest): boolean {
    return !!req?.transactions?.length
        || logsRequested(req) && !!req?.fields?.log?.transaction
}


function receiptsRequested(req?: DataRequest): boolean {
    if (!transactionsRequested(req)) return false
    let tx = req?.fields?.transaction
    if (tx == null) return false
    return !!(
        tx.status || tx.type || tx.gasUsed || tx.cumulativeGasUsed || tx.effectiveGasPrice
    )
}
