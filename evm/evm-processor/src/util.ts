import assert from 'assert'
import type {BlockItem} from './interfaces/data'

/**
 * Formats the event id into a fixed-length string. When formatted the natural string ordering
 * is the same as the ordering
 * in the blockchain (first ordered by block height, then by block ID)
 *
 * @return  id in the format 000000..00<blockNum>-000<index>-<shorthash>
 *
 */
export function formatId(height: number, hash: string, index?: number): string {
    let blockPart = String(height).padStart(10, '0')
    let indexPart =
        index !== undefined
            ? '-' + String(index).padStart(6, '0')
            : ''
    let _hash = hash.startsWith('0x') ? hash.slice(2) : hash
    let shortHash =
        _hash.length < 5
            ? _hash.padEnd(5, '0')
            : _hash.slice(0, 5)
    return `${blockPart}${indexPart}-${shortHash}`
}


export function blockItemOrder(a: BlockItem, b: BlockItem): number {
    if (a.kind == 'log' && b.kind == 'log') {
        return a.log.logIndex - b.log.logIndex
    } else if (a.kind == 'transaction' && b.kind == 'transaction') {
        return a.transaction.transactionIndex - b.transaction.transactionIndex
    } else if (a.kind == 'log' && b.kind == 'transaction') {
        return a.log.transactionIndex - b.transaction.transactionIndex || -1 // transaction after logs
    } else if (a.kind == 'transaction' && b.kind == 'log') {
        return a.transaction.transactionIndex - b.log.transactionIndex || 1
    } else {
        assert(false)
    }
}


export interface BlockContext {
    blockHeight?: number
    blockHash?: string
}
