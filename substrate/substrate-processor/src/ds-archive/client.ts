import {HttpClient} from '@subsquid/util-internal-http-client'
import {ArchiveDataSource, BatchRequest, BatchResponse} from '@subsquid/util-internal-processor-tools'
import assert from 'assert'
import {BlockDataP, DataRequest} from '../interfaces/data'
import {SpecId, SpecMetadata} from '../interfaces/substrate'


export class SubstrateArchive implements ArchiveDataSource<DataRequest, BlockDataP> {
    constructor(private http: HttpClient) {}

    getFinalizedBatch(request: BatchRequest<DataRequest>): Promise<BatchResponse<BlockDataP>> {
        return Promise.reject()
    }

    getFinalizedHeight(): Promise<number> {
        return Promise.resolve(0)
    }

    async getSpecId(height: number): Promise<SpecId> {
        let res: {batch: {header: {specId: SpecId}}[]} = await this.http.graphqlRequest(`
            query {
                batch(fromBlock: ${height} toBlock: ${height} includeAllBlocks: true limit: 1) {
                    header {
                        specId
                    }
                }
            }
        `)
        if (res.batch.length == 0) throw new Error(`Block ${height} not found in archive`)
        assert(res.batch.length === 1)
        return res.batch[0].header.specId
    }

    async getSpecMetadata(specId: SpecId): Promise<SpecMetadata> {
        let res = await this.http.graphqlRequest<{metadataById: SpecMetadata | null}>(`
            query {
                metadataById(id: "${specId}") {
                    id
                    specName
                    specVersion
                    blockHeight
                    hex
                }
            }
        `)
        if (res.metadataById == null) {
            throw new Error(`Metadata for spec ${specId} not found in archive`)
        } else {
            return res.metadataById
        }
    }
}
