import { HexString } from './index.js';
import { PoolMetadata } from './poolMetadata.js';
export type FileType = {
    uri: string;
    mime: string;
};
export type PoolReport = {
    author: {
        name: string;
        title: string;
        avatar: FileType | null;
    };
    uri: string;
};
export type ShareClassInput = {
    tokenName: string;
    symbolName: string;
    minInvestment?: number | null;
    apyPercentage?: number | null;
    apy?: 'target' | '7day' | '30day' | '90day' | 'ytd' | 'sinceInception' | 'automatic' | null;
    salt?: string;
    defaultAccounts?: PoolMetadata['shareClasses'][HexString]['defaultAccounts'];
};
export type IssuerDetail = {
    title: string;
    body: string;
};
export type PoolMetadataInput = {
    poolStructure: 'revolving';
    assetClass: 'Public credit' | 'Private credit';
    subAssetClass: string;
    shareClasses: ShareClassInput[];
    poolName: string;
    investorType: string;
    poolIcon: FileType;
    poolType: 'open' | 'closed';
    issuerName: string;
    issuerRepName: string;
    issuerLogo: FileType;
    issuerShortDescription: string;
    issuerDescription: string;
    website: string;
    forum: string;
    email: string;
    executiveSummary: FileType | null;
    details?: IssuerDetail[];
    issuerCategories: {
        type: string;
        value: string;
        description?: string;
    }[];
    poolRatings: {
        agency?: string;
        value?: string;
        reportUrl?: string;
        reportFile?: FileType | null;
    }[];
    report?: PoolReport | null;
    onboardingExperience: string;
    onboarding?: {
        shareClasses: {
            [scId: string]: {
                agreement: FileType | undefined;
                openForOnboarding: boolean;
            };
        };
        taxInfoRequired?: boolean;
        externalOnboardingUrl?: string;
    };
    underlying?: {
        poolId?: number;
    };
    holdings?: {
        headers: string[];
        data: Record<string, unknown>[];
    };
    listed?: boolean;
};
//# sourceMappingURL=poolInput.d.ts.map