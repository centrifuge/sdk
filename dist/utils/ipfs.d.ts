export declare function createPinning(pinningApiUrl: string): {
    pinFile: (b64URI: string) => Promise<string>;
    pinJson: (json: any) => Promise<string>;
};
export declare function pinToApi(url: string, reqInit?: RequestInit): Promise<string>;
export declare function getUrlFromHash(uriOrHash: string, ipfsGateway: string): string;
//# sourceMappingURL=ipfs.d.ts.map