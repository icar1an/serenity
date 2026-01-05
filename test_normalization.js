const r = /^(\/?(?:channel|user|c)\/|[\s/@]+)+/i;

const tests = [
    ['/@handle', 'handle'],
    ['@@handle', 'handle'],
    ['/@/@handle', 'handle'],
    ['/channel/UC123', 'UC123'],
    ['//channel//@handle', 'handle'],
    ['  @openart_ai  ', 'openart_ai'],
    ['https://www.youtube.com/@openart_ai', 'https://www.youtube.com/@openart_ai'], // Should not touch full URLs unless they start with the prefix
    ['/c/something', 'something'],
    ['user/pewdiepie', 'pewdiepie']
];

let failed = false;
tests.forEach(([input, expected]) => {
    const actual = input.trim().replace(r, '').replace(/\/+$/, '');
    if (actual === expected) {
        console.log(`✅ PASS: '${input}' -> '${actual}'`);
    } else {
        console.log(`❌ FAIL: '${input}' -> '${actual}' (Expected: '${expected}')`);
        failed = true;
    }
});

if (failed) process.exit(1);
