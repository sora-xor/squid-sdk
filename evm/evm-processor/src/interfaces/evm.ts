export type Bytes = string
export type Bytes8 = string
export type Bytes20 = string
export type Bytes32 = string
export type Qty = string


export interface EvmBlock {
    id: string
    height: number
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
    difficulty?: bigint
    totalDifficulty?: bigint
    extraData: Bytes
    size: bigint
    gasLimit: bigint
    gasUsed: bigint
    timestamp: number
    baseFeePerGas?: bigint
}


export interface EvmTransaction {
    id: string
    from: Bytes20
    gas: bigint
    gasPrice: bigint
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
    hash: Bytes32
    input: Bytes
    nonce: number
    to?: Bytes20
    transactionIndex: number
    value: bigint
    v?: bigint
    r?: Bytes32
    s?: Bytes32
    yParity?: number
    chainId?: number
    sighash: Bytes
    gasUsed?: bigint
    cumulativeGasUsed?: bigint
    effectiveGasPrice?: bigint
    type?: number
    status?: number
}


export interface EvmLog {
    id: string
    logIndex: number
    transactionIndex: number
    address: Bytes20
    data: Bytes
    topics: Bytes32[]
}
