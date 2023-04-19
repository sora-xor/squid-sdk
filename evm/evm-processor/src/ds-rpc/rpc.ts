import {Bytes, Bytes20, Bytes32, Bytes8, Qty} from '../interfaces/evm'


export interface Block {
    number: Qty
    hash: Bytes32
    parentHash: Bytes32
    nonce: Bytes8
    sha3Uncles: Bytes32
    logsBloom: Bytes
    transactionsRoot: Bytes
    stateRoot: Bytes32
    receiptsRoot: Bytes32
    miner: Bytes20
    difficulty: Qty
    totalDifficulty: Qty
    extraData: Bytes
    size: Qty
    gasLimit: Qty
    gasUsed: Qty
    timestamp: Qty
    transactions: Bytes32[] | Transaction[]
    uncles: Bytes32[]
}


export interface Transaction {
    blockHash: Bytes32
    blockNumber: Qty
    from: Bytes20
    gas: Qty
    gasPrice: Qty
    hash: Bytes32
    input: Bytes
    nonce: Qty
    to: Bytes20 | null
    transactionIndex: Qty
    value: Qty
    v: Qty
    r: Qty
    s: Qty
    receipt?: TransactionReceipt
}


export interface TransactionReceipt {
    transactionHash: Bytes32
    cumulativeGasUsed: Qty
    effectiveGasPrice: Qty
    gasUsed: Qty
    logs: Log[]
    type: Qty
    status: Qty
}


export interface Log {
    logIndex: Qty
    transactionIndex: Qty
    transactionHash: Bytes32
    blockHash: Bytes32
    blockNumber: Bytes32
    address: Bytes20
    data: Bytes
    topics: Bytes32[]
}
