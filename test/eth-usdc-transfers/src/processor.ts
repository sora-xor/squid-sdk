import {EvmBatchProcessor} from '@subsquid/evm-processor'
import {TypeormDatabase} from '@subsquid/typeorm-store'
import * as erc20 from './abi/erc20'
import {Transfer} from './model'


const CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'


const processor = new EvmBatchProcessor()
    .setDataSource({
        archive: 'https://v2.archive.subsquid.io/network/ethereum-mainnet',
        chain: 'https://rpc.ankr.com/eth'
    })
    .addLog({
        address: CONTRACT,
        filter: [[erc20.events.Transfer.topic]],
    })
    .setFields({
        log: {transactionHash: false}
    })


processor.run(new TypeormDatabase({supportHotBlocks: true}), async ctx => {
    let transfers: Transfer[] = []

    for (let block of ctx.blocks) {
        for (let item of block.items) {
            if (item.kind == 'log' && item.log.address === CONTRACT && item.log.topics[0] == erc20.events.Transfer.topic) {
                let {from, to, value} = erc20.events.Transfer.decode(item.log)
                transfers.push(new Transfer({
                    id: item.log.id,
                    blockNumber: block.header.height,
                    timestamp: new Date(block.header.timestamp),
                    txHash: '0x',
                    from,
                    to,
                    amount: value.toBigInt()
                }))
            }
        }
    }

    await ctx.store.insert(transfers)
})
