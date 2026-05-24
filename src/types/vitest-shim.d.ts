type TestFn = (name: string, fn: (...args: any[]) => any, timeout?: number) => void;
type SuiteFn = TestFn;
type HookFn = (fn: (...args: any[]) => any, timeout?: number) => void;
type MockFn = ((...args: any[]) => any) & {
  mock: { calls: any[][] };
  mockClear: () => void;
  mockReset: () => void;
  mockResolvedValue: (value: any) => MockFn;
  mockResolvedValueOnce: (value: any) => MockFn;
  mockRejectedValue: (value: any) => MockFn;
  mockRejectedValueOnce: (value: any) => MockFn;
  mockImplementation: (fn: (...args: any[]) => any) => MockFn;
  mockImplementationOnce: (fn: (...args: any[]) => any) => MockFn;
};

type ExpectFn = ((actual: any, message?: string) => any) & {
  objectContaining: (value: any) => any;
  arrayContaining: (value: any[]) => any;
  anything: () => any;
};

export const describe: SuiteFn;
export const it: TestFn;
export const test: TestFn;
export const beforeAll: HookFn;
export const beforeEach: HookFn;
export const afterAll: HookFn;
export const afterEach: HookFn;
export const expect: ExpectFn;
export const vi: {
  fn: (implementation?: (...args: any[]) => any) => MockFn;
  mock: (id: string, factory?: () => any) => void;
  clearAllMocks: () => void;
  resetModules: () => void;
  resetAllMocks: () => void;
  restoreAllMocks: () => void;
  spyOn: (object: any, method: string) => MockFn;
  stubGlobal: (name: string, value: any) => void;
  unstubAllGlobals: () => void;
};

declare global {
  const describe: SuiteFn;
  const it: TestFn;
  const test: TestFn;
  const beforeAll: HookFn;
  const beforeEach: HookFn;
  const afterAll: HookFn;
  const afterEach: HookFn;
  const expect: ExpectFn;
  const vi: {
    fn: (implementation?: (...args: any[]) => any) => MockFn;
    mock: (id: string, factory?: () => any) => void;
    clearAllMocks: () => void;
    resetModules: () => void;
    resetAllMocks: () => void;
    restoreAllMocks: () => void;
    spyOn: (object: any, method: string) => MockFn;
    stubGlobal: (name: string, value: any) => void;
    unstubAllGlobals: () => void;
  };
}
