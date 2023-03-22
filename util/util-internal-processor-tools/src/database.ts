/**
 * Database is responsible for providing a persistent storage for data handlers
 * and keeping the processor progress and status.
 */
export type Database<S> = FinalDatabase<S> | HotDatabase<S>


export interface FinalDatabase<S> {
    supportsHotBlocks?: false

    connect(): Promise<{height: number}>

    transact(
        info: {from: number, to: number, isHead: boolean},
        cb: (store: S) => Promise<void>
    ): Promise<void>
}


export interface HotDatabase<S> {
    supportsHotBlocks: true

    connect(): Promise<HotDatabaseState>

    transact(
        info: {from: number, to: number, isHead: boolean},
        cb: (store: S) => Promise<void>
    ): Promise<void>

    transactHot<B extends {header: HashAndHeight}>(
        info: {blocks: B[], finalizedHead: HashAndHeight},
        cb: (store: S, block: B) => Promise<void>
    ): Promise<void>
}


export interface HashAndHeight {
    height: number
    hash: string
}


export interface HotDatabaseState {
    height: number
    top: HashAndHeight[]
}
