import {HashAndHeight} from './database'


export function getOrGenerateSquidId(): string {
    return process.env.SQUID_ID || `gen-${randomString(10)}`
}


function randomString(len: number) {
    let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
}


export function timeInterval(seconds: number): string {
    if (seconds < 60) {
        return Math.round(seconds) + 's'
    }
    let minutes = Math.ceil(seconds/60)
    if (minutes < 60) {
        return  minutes+'m'
    }
    let hours = Math.floor(minutes / 60)
    minutes = minutes - hours * 60
    return hours + 'h ' + minutes + 'm'
}


export function getItemsCount(blocks: {items: unknown[]}[]): number {
    let count = 0
    for (let i = 0; i < blocks.length; i++) {
        count += blocks[i].items.length
    }
    return count
}


export function formatHead(head: HashAndHeight): string {
    return `${head.height}#${head.hash.slice(2, 10)}`
}
