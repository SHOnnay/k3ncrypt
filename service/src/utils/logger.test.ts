import { setConfig } from '../configContext';
import { Logger } from './logger';

describe('production logging safety', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = 'production';
    setConfig({ settings: { disableLog: true } });
    process.env.NODE_ENV = originalNodeEnv;
    consoleLog.mockRestore();
  });

  it('cannot be enabled through SDK settings in production', () => {
    process.env.NODE_ENV = 'production';
    setConfig({ settings: { disableLog: false } });
    new Logger('test').log('diagnostic');
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
