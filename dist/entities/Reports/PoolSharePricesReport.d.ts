import { Centrifuge } from '../../Centrifuge.js';
import { HexString } from '../../types/index.js';
import { Balance, Price } from '../../utils/BigInt.js';
import { ShareClassId } from '../../utils/types.js';
import { Entity } from '../Entity.js';
import { Pool } from '../Pool.js';
import { PoolReports } from './PoolReports.js';
import { DataReportFilter } from './types.js';
export type SharePricesReport = {
    timestamp: string;
    shareClasses: Record<HexString, {
        price: Price;
        totalIssuance: Balance;
    }>;
}[];
export type SharePricesReportFilter = DataReportFilter & {
    shareClassId?: ShareClassId;
};
export declare class PoolSharePricesReport extends Entity {
    poolReports: PoolReports;
    pool: Pool;
    constructor(centrifuge: Centrifuge, poolReports: PoolReports);
    /**
     * Get the share prices report for a pool.
     * @param filter - The filter for the report.
     * @returns The share prices report.
     */
    report(filter?: SharePricesReportFilter): import("../../index.js").Query<SharePricesReport>;
}
//# sourceMappingURL=PoolSharePricesReport.d.ts.map