import { Centrifuge } from '../Centrifuge.js';
import { TenderlyFork } from './tenderly.js';
declare class TestContext {
    #private;
    tenderlyFork: TenderlyFork;
    get centrifuge(): Centrifuge;
    initialize(): Promise<void>;
    cleanup(): Promise<boolean | undefined>;
}
export declare const context: TestContext;
export declare const mochaHooks: {
    beforeAll(this: Mocha.Context & TestContext): Promise<void>;
    afterAll(this: Mocha.Context & TestContext): Promise<void>;
};
export {};
//# sourceMappingURL=setup.d.ts.map