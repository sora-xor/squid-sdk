export type Bytes = string
export type Bytes32 = string
export type EvmAddress = string


export interface EvmBlock {
    id: string
    height: number
    hash: Bytes32
    parentHash: Bytes32
    timestamp: number
    size: bigint
    extraData: Bytes
    logsBloom: Bytes
    transactionsRoot: Bytes32
    stateRoot: Bytes32
    receiptsRoot: Bytes32
    miner: EvmAddress
    sha3Uncles: Bytes32
    nonce: bigint
    gasLimit: bigint
    gasUsed: bigint
    difficulty?: bigint
    totalDifficulty?: bigint
    baseFeePerGas?: bigint
    mixHash?: Bytes32
}


export interface EvmTransaction {
    id: string
    index: number
    hash: Bytes32
    from: EvmAddress
    to?: EvmAddress
    input: Bytes
    nonce: bigint
    v: bigint
    r: string
    s: string
    value: bigint
    gas: bigint
    gasPrice?: bigint
    maxPriorityFeePerGas?: bigint
    maxFeePerGas?: bigint
    yParity?: number
    status?: number
    chainId?: number
}


export interface EvmLog {
    id: string
    index: number
    transactionIndex: number
    transactionHash: string
    address: EvmAddress
    topics: Bytes32[]
    data: Bytes
}
