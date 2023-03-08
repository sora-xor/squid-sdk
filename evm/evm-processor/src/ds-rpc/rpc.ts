import {Bytes, Bytes32, EvmAddress} from '../interfaces/evm'

/**
 * Hex QUANTITY string
 */
export type Qty = string
export type Bytes8 = string


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
    miner: EvmAddress
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
    from: EvmAddress
    gas: Qty
    gasPrice: Qty
    hash: Bytes32
    input: Bytes
    nonce: Qty
    to: EvmAddress | null
    transactionIndex: Qty
    value: Qty
    v: Qty
    r: Qty
    s: Qty
    receipt?: TransactionReceipt
}


export interface TransactionReceipt {
    transactionHash: Bytes32
    logs: Log[]
    status: Qty
}


export interface Log {
    logIndex: Qty
    transactionIndex: Qty
    transactionHash: Bytes32
    blockHash: Bytes32
    blockNumber: Bytes32
    address: EvmAddress
    data: Bytes
    topics: Bytes32[]
}
