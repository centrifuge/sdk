import { Entity } from '../Entity.js';
import { Pool } from '../Pool.js';
import { SharePricesReportFilter } from './PoolSharePricesReport.js';
export declare class PoolReports extends Entity {
    pool: Pool;
    sharePrices(filter?: SharePricesReportFilter): import("../../index.js").Query<import("./PoolSharePricesReport.js").SharePricesReport>;
}
//# sourceMappingURL=PoolReports.d.ts.map