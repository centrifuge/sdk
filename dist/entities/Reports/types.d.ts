import type { GroupBy } from '../../utils/date.js';
export type ReportFilter = {
    from?: number;
    to?: number;
};
export type DataReportFilter = ReportFilter & {
    groupBy?: GroupBy;
};
//# sourceMappingURL=types.d.ts.map