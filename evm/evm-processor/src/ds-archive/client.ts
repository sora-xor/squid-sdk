import {addErrorContext, last, withErrorContext} from '@subsquid/util-internal'
import {HttpClient} from '@subsquid/util-internal-http-client'
import {ArchiveDataSource, BatchRequest, BatchResponse} from '@subsquid/util-internal-processor-tools'
import {DataRequest, DEFAULT_FIELDS, Fields, FullBlockData, FullLogItem} from '../interfaces/data'
import {EvmBlock, EvmLog, EvmTransaction} from '../interfaces/evm'
import {blockItemOrder, formatId} from '../util'
import * as gw from './gateway'


export class EvmArchive implements ArchiveDataSource<DataRequest, FullBlockData> {
    private lastKnownChainHeight?: number

    constructor(private http: HttpClient) {}

    async getFinalizedBatch(request: BatchRequest<DataRequest>): Promise<BatchResponse<FullBlockData>> {
        let q: gw.BatchRequest = {
            fromBlock: request.range.from,
            toBlock: request.range.to,
            includeAllBlocks: !!request.request.includeAllBlocks,
            fields: withDefaultFields(request.request.fields),
            transactions: request.request.transactions
        }

        q.logs = request.request.logs?.map(log => {
            return {
                address: log.address,
                topic0: log.filter?.[0]
            }
        })

        let res = await this.query(q)

        let batch: BatchResponse<FullBlockData> = {
            range: {from: request.range.from, to: last(res.blocks).header.number},
            blocks: [],
            chainHeight: res.chainHeight
        }

        for (let gwb of res.blocks) {
            batch.blocks.push(
                tryMapGatewayBlock(gwb)
            )
        }

        return batch
    }

    private async query(q: gw.BatchRequest): Promise<{blocks: gw.BlockData[], chainHeight: number}> {
        let worker: string = await this.http.get(`/${q.fromBlock}/worker`)

        let blocks: gw.BlockData[] = await this.http.post(worker, {json: q})
            .catch(withErrorContext({archiveQuery: q}))

        let chainHeight = this.lastKnownChainHeight && last(blocks).header.number < this.lastKnownChainHeight
            ? this.lastKnownChainHeight
            : await this.getFinalizedHeight()

        return {blocks, chainHeight}
    }

    async getFinalizedHeight(): Promise<number> {
        let height = await this.http.get('/height').then(s => parseInt(s))
        this.lastKnownChainHeight = height
        return height
    }
}


function tryMapGatewayBlock(src: gw.BlockData): FullBlockData {
    try {
        return mapGatewayBlock(src)
    } catch (e: any) {
        throw addErrorContext(e, {
            blockHeight: src.header.number,
            blockHash: src.header.hash,
        })
    }
}


function mapGatewayBlock(src: gw.BlockData): FullBlockData {
    let header = mapGatewayBlockHeader(src.header)

    let items: FullBlockData['items'] = []
    let txIndex = new Map<EvmTransaction['transactionIndex'], EvmTransaction>()

    for (let gtx of src.transactions || []) {
        let transaction = mapGatewayTransaction(header.height, header.hash, gtx)
        items.push({kind: 'transaction', transaction})
        txIndex.set(transaction.transactionIndex, transaction)
    }

    for (let gl of src.logs || []) {
        let log = mapGatewayLog(header.height, header.hash, gl)
        let item: Partial<FullLogItem> = {kind: 'log', log}
        let transaction = txIndex.get(log.transactionIndex)
        if (transaction) {
            item.transaction = transaction
        }
        items.push(item as FullLogItem)
    }

    items.sort(blockItemOrder)

    return {header, items}
}


function mapGatewayBlockHeader(src: gw.Block): EvmBlock {
    let header: Partial<EvmBlock> = {
        id: formatId(src.number, src.hash),
        height: src.number,
        hash: src.hash
    }

    let key: keyof gw.Block
    for (key in src) {
        switch(key) {
            case 'number':
            case 'hash':
                break
            case 'timestamp':
                header.timestamp = src.timestamp * 1000
                break
            case 'difficulty':
            case 'totalDifficulty':
            case 'size':
            case 'gasUsed':
            case 'gasLimit':
            case 'baseFeePerGas':
                header[key] = BigInt(src[key]!)
                break
            default:
                header[key] = src[key]
        }
    }

    return header as EvmBlock
}


function mapGatewayTransaction(blockHeight: number, blockHash: string, src: gw.Transaction): EvmTransaction {
    let tx: Partial<EvmTransaction> = {
        id: formatId(blockHeight, blockHash, src.transactionIndex)
    }

    let key: keyof gw.Transaction
    for (key in src) {
        switch(key) {
            case 'from':
            case 'to':
            case 'hash':
            case 'input':
            case 'r':
            case 's':
                tx[key] = src[key]
                break
            case 'gas':
            case 'gasPrice':
            case 'value':
            case 'v':
            case 'maxFeePerGas':
            case 'maxPriorityFeePerGas':
                tx[key] = BigInt(src[key]!)
                break
            case 'transactionIndex':
            case 'chainId':
            case 'yParity':
            case 'nonce':
                tx[key] = src[key]
                break
        }
    }

    return tx as EvmTransaction
}


function mapGatewayLog(blockHeight: number, blockHash: string, src: gw.Log): EvmLog {
    let log: Partial<EvmLog> = {
        id: formatId(blockHeight, blockHash, src.logIndex),
        logIndex: src.logIndex
    }

    let key: keyof gw.Log
    for (key in src) {
        switch(key) {
            case 'address':
            case 'data':
                log[key] = src[key]
                break
            case 'topics':
                log.topics = src.topics
                break
            case 'transactionIndex':
                log.transactionIndex = src.transactionIndex
                break
        }
    }

    return log as EvmLog
}


function withDefaultFields(fields?: Fields): gw.Fields {
    let {height, ...blockFields} = mergeDefaultFields(DEFAULT_FIELDS.block, fields?.block)
    return  {
        block: {
            ...blockFields,
            number: true,
            hash: true,
            parentHash: true
        },
        transaction: {
            ...mergeDefaultFields(DEFAULT_FIELDS.transaction, fields?.transaction),
            transactionIndex: true
        },
        log: {
            ...mergeDefaultFields(DEFAULT_FIELDS.log, fields?.log),
            logIndex: true,
            transactionIndex: true
        }
    }
}


function mergeDefaultFields<Props extends string>(
    defaults: gw.Selector<Props>,
    selection?: gw.Selector<Props>
): gw.Selector<Props> {
    let result: gw.Selector<Props> = {...defaults}
    for (let key in selection) {
        if (selection[key] != null) {
            if (selection[key]) {
                result[key] = true
            } else {
                delete result[key]
            }
        }
    }
    return result
}
