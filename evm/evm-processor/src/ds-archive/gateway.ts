import {Bytes, Bytes20, Bytes32, Bytes8, Qty} from '../interfaces/evm'


export interface BatchRequest {
    fromBlock: number
    toBlock?: number
    includeAllBlocks?: boolean
    fields?: Fields
    logs?: LogRequest[]
    transactions?: TransactionRequest[]
}


export interface LogRequest {
    address?: Bytes20[]
    topic0?: Bytes32[]
}


export interface TransactionRequest {
    to?: Bytes20[]
    from?: Bytes20[]
    sighash?: Bytes[]
}


export interface Fields {
    block?: Selector<keyof Block>
    transaction?: Selector<keyof Transaction>
    log?: Selector<keyof Log | 'transaction'>
}


export type Selector<Props extends string> = {
    [P in Props]?: boolean
}


export interface Block {
    number: number
    hash: Bytes32
    parentHash: Bytes32
    nonce?: Bytes8
    sha3Uncles: Bytes32
    logsBloom: Bytes
    transactionsRoot: Bytes32
    stateRoot: Bytes32
    receiptsRoot: Bytes32
    mixHash?: Bytes
    miner: Bytes20
    difficulty?: Qty
    totalDifficulty?: Qty
    extraData: Bytes
    size: Qty
    gasLimit: Qty
    gasUsed: Qty
    timestamp: number
    baseFeePerGas?: Qty
}


export interface Transaction {
    from: Bytes20
    gas: Qty
    gasPrice: Qty
    maxFeePerGas?: Qty
    maxPriorityFeePerGas?: Qty
    hash: Bytes32
    input: Bytes
    nonce: number
    to?: Bytes20
    transactionIndex: number
    value: Qty
    v?: Qty
    r?: Bytes32
    s?: Bytes32
    yParity?: number
    chainId?: number
    sighash: Bytes
    gasUsed?: Qty
    cumulativeGasUsed?: Qty
    effectiveGasPrice?: Qty
    type?: number
    status?: number
}


export interface Log {
    logIndex: number
    transactionIndex: number
    address: string
    data: string
    topics: string[]
}


export interface BlockData {
    header: Block
    logs: Log[]
    transactions: Transaction[]
}
