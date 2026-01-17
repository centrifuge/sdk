import { Entity } from '../Entity.js';
import { PoolSharePricesReport } from './PoolSharePricesReport.js';
export class PoolReports extends Entity {
    pool;
    /** @internal */
    constructor(centrifuge, pool) {
        super(centrifuge, ['poolReports', pool.id.toString()]);
        this.pool = pool;
    }
    sharePrices(filter) {
        return new PoolSharePricesReport(this._root, this).report(filter);
    }
}
//# sourceMappingURL=PoolReports.js.map