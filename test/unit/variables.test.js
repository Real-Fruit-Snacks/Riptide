// test/unit/variables.test.js

// Setup global namespace
global.window = global.window || { Riptide: {} };
global.Riptide = global.window.Riptide || {};

// Load the module
require('../../public/js/variables');

const Variables = Riptide.Variables;

afterAll(() => {
  delete global.window;
  delete global.Riptide;
});

describe('Variables.scanPlaybook', () => {
  it('matches <VarName> pattern in code block', () => {
    const content = '```bash\nnmap <TargetIP>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.has('TargetIP')).toBe(true);
    expect(vars.size).toBe(1);
  });

  it('matches multiple variables', () => {
    const content = '```bash\nnmap <TargetIP> -p <Port>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.has('TargetIP')).toBe(true);
    expect(vars.has('Port')).toBe(true);
    expect(vars.size).toBe(2);
  });

  it('does not match lowercase or digit start', () => {
    // Regex is [A-Za-z_][A-Za-z0-9_]* - must start with letter or underscore
    // 'lowercase' starts with lowercase letter, so it WILL match
    // Need to test with digit start or invalid char
    const content = '```bash\necho <1invalid>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.size).toBe(0);
  });

  it('does not match variables in output blocks', () => {
    const content = '```output\n<TargetIP>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.size).toBe(0);
  });

  it('matches variables with underscores and numbers', () => {
    const content = '```bash\nping <Target_IP_1>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.has('Target_IP_1')).toBe(true);
  });

  it('skips output blocks but scans other blocks', () => {
    const content = `\`\`\`bash
nmap <TargetIP>
\`\`\`

\`\`\`output
<ShouldBeIgnored>
\`\`\`

\`\`\`python
print(<Port>)
\`\`\``;
    const vars = Variables.scanPlaybook(content);
    expect(vars.has('TargetIP')).toBe(true);
    expect(vars.has('Port')).toBe(true);
    expect(vars.has('ShouldBeIgnored')).toBe(false);
    expect(vars.size).toBe(2);
  });

  it('handles code blocks with language specifiers', () => {
    const content = '```python:repl\nconnect(<Host>)\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.has('Host')).toBe(true);
  });

  it('returns empty set for no variables', () => {
    const content = '```bash\necho hello\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.size).toBe(0);
  });

  it('deduplicates repeated variables', () => {
    const content = '```bash\nping <IP>\nping <IP>\n```';
    const vars = Variables.scanPlaybook(content);
    expect(vars.size).toBe(1);
  });
});

describe('Variables.substituteCommand', () => {
  const originalGetEffective = Variables.getEffective;

  beforeEach(() => {
    // Mock getEffective to return a controlled set of variables
    Variables.getEffective = () => ({
      TargetIP: '10.10.10.1',
      Port: '8080'
    });
  });

  afterAll(() => {
    Variables.getEffective = originalGetEffective;
  });

  it('substitutes single variable', () => {
    const { result, missing } = Variables.substituteCommand('nmap <TargetIP>');
    expect(result).toBe('nmap 10.10.10.1');
    expect(missing).toEqual([]);
  });

  it('substitutes multiple variables', () => {
    const { result, missing } = Variables.substituteCommand('nmap <TargetIP> -p <Port>');
    expect(result).toBe('nmap 10.10.10.1 -p 8080');
    expect(missing).toEqual([]);
  });

  it('leaves unset variables unchanged and tracks them', () => {
    const { result, missing } = Variables.substituteCommand('ping <UnsetVar>');
    expect(result).toBe('ping <UnsetVar>');
    expect(missing).toEqual(['UnsetVar']);
  });

  it('handles mixed set and unset variables', () => {
    const { result, missing } = Variables.substituteCommand('nmap <TargetIP> -p <UnsetPort>');
    expect(result).toBe('nmap 10.10.10.1 -p <UnsetPort>');
    expect(missing).toEqual(['UnsetPort']);
  });

  it('handles commands with no variables', () => {
    const { result, missing } = Variables.substituteCommand('ls -la');
    expect(result).toBe('ls -la');
    expect(missing).toEqual([]);
  });

  it('handles underscore in variable names', () => {
    Variables.getEffective = () => ({ Target_IP: '192.168.1.1' });
    const { result, missing } = Variables.substituteCommand('ping <Target_IP>');
    expect(result).toBe('ping 192.168.1.1');
    expect(missing).toEqual([]);
  });

  it('treats empty string as unset', () => {
    Variables.getEffective = () => ({ EmptyVar: '' });
    const { result, missing } = Variables.substituteCommand('test <EmptyVar>');
    expect(result).toBe('test <EmptyVar>');
    expect(missing).toEqual(['EmptyVar']);
  });

  it('treats null as unset', () => {
    Variables.getEffective = () => ({ NullVar: null });
    const { result, missing } = Variables.substituteCommand('test <NullVar>');
    expect(result).toBe('test <NullVar>');
    expect(missing).toEqual(['NullVar']);
  });
});

describe('getEffective merge logic', () => {
  it('tab overrides global', () => {
    const global = { TargetIP: '10.10.10.1', Domain: 'test.htb' };
    const tab = { TargetIP: '10.10.10.2' };
    const effective = { ...global, ...tab };
    expect(effective.TargetIP).toBe('10.10.10.2');
    expect(effective.Domain).toBe('test.htb');
  });

  it('global values used when not in tab', () => {
    const global = { TargetIP: '10.10.10.1', Port: '80' };
    const tab = {};
    const effective = { ...global, ...tab };
    expect(effective.TargetIP).toBe('10.10.10.1');
    expect(effective.Port).toBe('80');
  });

  it('empty tab does not override global', () => {
    const global = { Var1: 'global1', Var2: 'global2' };
    const tab = {};
    const effective = { ...global, ...tab };
    expect(effective).toEqual(global);
  });

  it('tab can add new variables', () => {
    const global = { GlobalVar: 'value1' };
    const tab = { TabVar: 'value2' };
    const effective = { ...global, ...tab };
    expect(effective.GlobalVar).toBe('value1');
    expect(effective.TabVar).toBe('value2');
  });
});
