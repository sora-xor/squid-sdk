import {createOrmConfig} from '@subsquid/typeorm-config'
import {assertNotNull, last, maybeLast} from '@subsquid/util-internal'
import assert from 'assert'
import {DataSource, EntityManager} from 'typeorm'
import {ChangeTracker, rollbackBlockChanges} from './hot'
import {DatabaseState, FinalTxInfo, HashAndHeight, HotTxInfo} from './interfaces'
import {Store} from './store'


export type IsolationLevel = 'SERIALIZABLE' | 'READ COMMITTED' | 'REPEATABLE READ'


export interface TypeormDatabaseOptions {
    isolationLevel?: IsolationLevel
    stateSchema?: string
    supportHotBlocks?: boolean
}


export class TypeormDatabase<S> {
    private statusSchema: string
    private isolationLevel: IsolationLevel
    private con?: DataSource

    public readonly supportsHotBlocks: boolean

    constructor(options?: TypeormDatabaseOptions) {
        this.statusSchema = options?.stateSchema || 'squid_processor'
        this.isolationLevel = options?.isolationLevel || 'SERIALIZABLE'
        this.supportsHotBlocks = !!options?.supportHotBlocks
    }

    async connect(): Promise<DatabaseState> {
        assert(this.con == null, 'already connected')

        let cfg = createOrmConfig()
        let con = new DataSource(cfg)

        await con.initialize()

        try {
            let state = await con.transaction('SERIALIZABLE', em => this.initTransaction(em))
            this.con = con
            return state
        } catch(e: any) {
            await con.destroy().catch(() => {}) // ignore error
            throw e
        }
    }

    async disconnect(): Promise<void> {
        await this.con?.destroy()
        this.con = undefined
    }

    private async initTransaction(em: EntityManager): Promise<DatabaseState> {
        let schema = this.escapedSchema()

        await em.query(
            `CREATE SCHEMA IF NOT EXISTS ${schema}`
        )
        await em.query(
            `CREATE TABLE IF NOT EXISTS ${schema}.status (` +
            `id int primary key, ` +
            `height int not null, ` +
            `hash text DEFAULT '0x', ` +
            `nonce int DEFAULT 0`+
            `)`
        )
        await em.query( // for databases created by prev version of typeorm store
            `ALTER TABLE ${schema}.status ADD COLUMN IF NOT EXISTS hash text DEFAULT '0x'`
        )
        await em.query( // for databases created by prev version of typeorm store
            `ALTER TABLE ${schema}.status ADD COLUMN IF NOT EXISTS nonce int DEFAULT 0`
        )
        await em.query(
            `CREATE TABLE IF NOT EXISTS ${schema}.hot_block (height int primary key, hash text not null)`
        )
        await em.query(
            `CREATE TABLE IF NOT EXISTS ${schema}.hot_change_log (` +
            `block_height int non null references ${schema}.hot_blocks on delete cascade, ` +
            `index int not null, ` +
            `change jsonb not null, ` +
            `PRIMARY KEY (block_height, index)` +
            `)`
        )

        let status: (HashAndHeight & {nonce: number})[] = await em.query(
            `SELECT height, hash, nonce FROM ${schema}.status WHERE id = 0`
        )
        if (status.length == 0) {
            await em.query(`INSERT INTO ${schema}.status (id, height, hash) VALUES (0, -1, '0x')`)
            status.push({height: -1, hash: '0x', nonce: 0})
        }

        let top: HashAndHeight[] = await em.query(
            `SELECT height, hash FROM ${schema}.hot_blocks`
        )

        return assertStateInvariants({...status[0], top})
    }

    private async getState(em: EntityManager): Promise<DatabaseState> {
        let schema = this.escapedSchema()

        let status: (HashAndHeight & {nonce: number})[] = await em.query(
            `SELECT height, hash, nonce FROM ${schema}.status WHERE id = 0`
        )

        assert(status.length == 1)

        let top: HashAndHeight[] = await em.query(
            `SELECT hash, height FROM ${schema}.hot_block`
        )

        return assertStateInvariants({...status[0], top})
    }

    transact(info: FinalTxInfo, cb: (store: Store) => Promise<void>): Promise<void> {
        return this.submit(async em => {
            let state = await this.getState(em)
            let {prevHead: prev, nextHead: next} = info

            assert(state.hash === info.prevHead.hash, RACE_MSG)
            assert(state.height === prev.height)
            assert(prev.height < next.height)
            assert(prev.hash != next.hash)

            for (let i = state.top.length - 1; i >= 0; i--) {
                let block = state.top[i]
                await rollbackBlockChanges(this.statusSchema, em, block.height)
            }

            await this.performUpdates(cb, em)

            await this.updateStatus(em, state.nonce, next)
        })
    }

    transactHot(info: HotTxInfo, cb: (store: Store, block: HashAndHeight) => Promise<void>): Promise<void> {
        return this.submit(async em => {
            let state = await this.getState(em)
            let chain = [state, ...state.top]

            assertChainContinuity(info.baseBlock, info.blocks)
            assert(info.finalizedHead.height <= (maybeLast(info.blocks) ?? info.baseBlock).height)

            assert(chain.find(b => b.hash === info.baseBlock.hash), RACE_MSG)
            if (info.blocks.length == 0) {
                assert(last(chain).hash === info.baseBlock.hash, RACE_MSG)
            }
            assert(chain[0].height <= info.finalizedHead.height, RACE_MSG)

            let rollbackPos = info.baseBlock.height + 1 - chain[0].height

            for (let i = chain.length - 1; i >= rollbackPos; i--) {
                await rollbackBlockChanges(this.statusSchema, em, chain[i].height)
            }

            for (let b of info.blocks) {
                let changeTracker: ChangeTracker | undefined

                if (b.height > info.finalizedHead.height) {
                    await this.insertHotBlock(em, b)
                    changeTracker = new ChangeTracker(em, this.statusSchema, b.height)
                }

                await this.performUpdates(
                    store => cb(store, b),
                    em,
                    changeTracker
                )
            }

            chain = chain.slice(0, rollbackPos).concat(info.blocks)

            let finalizedHeadPos = info.finalizedHead.height - chain[0].height
            assert(chain[finalizedHeadPos].hash === info.finalizedHead.hash)
            await this.deleteHotBlocks(em, info.finalizedHead.height)

            await this.updateStatus(em, state.nonce, info.finalizedHead)
        })
    }

    private deleteHotBlocks(em: EntityManager, finalizedHeight: number): Promise<void> {
        return em.query(
            `DELETE FROM ${this.escapedSchema()}.hot_block WHERE height <= $1`,
            [finalizedHeight]
        )
    }

    private insertHotBlock(em: EntityManager, block: HashAndHeight): Promise<void> {
        return em.query(
            `INSERT INTO ${this.escapedSchema()}.hot_block (height, hash) VALUES ($1, $2)`,
            [block.height, block.hash]
        )
    }

    private async updateStatus(em: EntityManager, nonce: number, next: HashAndHeight): Promise<void> {
        let schema = this.escapedSchema()

        let result: [data: any[], rowsChanged: number] = await em.query(
            `UPDATE ${schema}.status SET height = $1, hash = $2, nonce = nonce + 1 WHERE id = 0 AND nonce = $3`,
            [next.height, next.hash, nonce]
        )

        let rowsChanged = result[1]

        // Will never happen if isolation level is SERIALIZABLE or REPEATABLE_READ,
        // but occasionally people use multiprocessor setups and READ_COMMITTED.
        assert.strictEqual(
            rowsChanged,
            1,
            RACE_MSG
        )
    }

    private async performUpdates(
        cb: (store: Store) => Promise<void>,
        em: EntityManager,
        changeTracker?: ChangeTracker
    ): Promise<void> {
        let running = true

        let store = new Store(
            () => {
                assert(running, `too late to perform db updates, make sure you haven't forgot to await on db query`)
                return em
            },
            changeTracker
        )

        try {
            await cb(store)
        } finally {
            running = false
        }
    }

    private async submit(tx: (em: EntityManager) => Promise<void>): Promise<void> {
        let retries = 3
        while (true) {
            try {
                let con = this.con
                assert(con != null, 'not connected')
                return await con.transaction(this.isolationLevel, tx)
            } catch(e: any) {
                if (e.code == '40001' && retries) {
                    retries -= 1
                } else {
                    throw e
                }
            }
        }
    }

    private escapedSchema(): string {
        let con = assertNotNull(this.con)
        return con.driver.escape(this.statusSchema)
    }
}


const RACE_MSG = 'status table was updated by foreign process, make sure no other processor is running'


function assertStateInvariants(state: DatabaseState): DatabaseState {
    let height = state.height

    // Sanity check. Who knows what driver will return?
    assert(Number.isSafeInteger(height))

    assertChainContinuity(state, state.top)

    return state
}


function assertChainContinuity(base: HashAndHeight, chain: HashAndHeight[]) {
    let prev = base
    for (let b of chain) {
        assert(b.height === prev.height + 1, 'blocks must form a continues chain')
        prev = b
    }
}
