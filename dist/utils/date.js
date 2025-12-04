export function getDateYearsFromNow(years) {
    return new Date(new Date().setFullYear(new Date().getFullYear() + years));
}
export function getPeriod(date, groupBy) {
    switch (groupBy) {
        case 'day':
            return date.toISOString().slice(0, 10);
        case 'month':
            const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
            return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}`;
        case 'quarter':
            const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
            return `${date.getUTCFullYear()}-Q${quarter}`;
        case 'year':
            return date.getUTCFullYear().toString();
        default:
            return undefined;
    }
}
export function groupByPeriod(data, groupBy, strategy = 'latest') {
    const grouped = new Map();
    data.forEach((item) => {
        const period = getPeriod(new Date(item.timestamp), groupBy);
        if (!period)
            return;
        if (!grouped.has(period)) {
            grouped.set(period, []);
        }
        grouped.get(period).push(item);
        // Sort by timestamp within each group
        grouped.get(period).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    });
    return strategy === 'latest'
        ? Array.from(grouped.values()).map((group) => group[group.length - 1])
        : Array.from(grouped.values());
}
//# sourceMappingURL=date.js.map