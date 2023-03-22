
export interface HashAndHeight {
    height: number
    hash: string
}


export interface DatabaseState {
    nonce: number
    height: number
    top: HashAndHeight[]
}


export interface FinalTxInfo {
    nonce: number
    from: number
    to: number
}


export interface HotTxInfo {
    nonce: number
    finalizedHead: HashAndHeight
    blocks: HashAndHeight[]
}
