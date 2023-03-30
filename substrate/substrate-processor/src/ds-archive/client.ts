import {ArchiveDataSource, BatchRequest, BatchResponse} from '@subsquid/util-internal-processor-tools'
import {BlockDataP, DataRequest} from '../interfaces/data'


export class SubstrateArchive implements ArchiveDataSource<DataRequest, BlockDataP> {
    getFinalizedBatch(request: BatchRequest<DataRequest>): Promise<BatchResponse<BlockDataP>> {
        return Promise.reject()
    }

    getFinalizedHeight(): Promise<number> {
        return Promise.resolve(0)
    }
}
