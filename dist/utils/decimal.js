import DecimalLight from 'decimal.js-light';
const Decimal = DecimalLight.default || DecimalLight;
Decimal.set({
    precision: 30,
    toExpNeg: -7,
    toExpPos: 29,
    rounding: Decimal.ROUND_HALF_CEIL,
});
export function Dec(value) {
    return new Decimal(value);
}
export { Decimal };
//# sourceMappingURL=decimal.js.map