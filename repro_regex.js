const normalize = (id) => {
    if (!id) return id;
    // Aggressively strip multiple leading slashes, @ symbols, and various YouTube path prefixes
    // This handles: /@handle, @@handle, /@/@handle, /channel/UC..., //channel//UC..., etc.
    return id.trim().replace(/^(\/?(?:channel|user|c)\/|[\s/@]+)+/i, '').replace(/\/+$/, '');
};

const buildChannelUrl = (channelId, handle) => {
    const identifier = normalize(handle || channelId);
    if (!identifier) return '#';

    // If it looks like a UC channel ID (24 chars, starts with UC), use /channel/ format
    if (/^UC[\w-]{22}$/.test(identifier)) {
        return `https://www.youtube.com/channel/${identifier}`;
    }

    // Default to handle format
    return `https://www.youtube.com/@${identifier}`;
};

const test1 = '/@buildingbettergames';
const test2 = ' @buildingbettergames ';
const test3 = 'UC1234567890123456789012';
const test4 = 'channel/UC...';
const test5 = '/user/pewdiepie';

console.log(`'${test1}' -> '${normalize(test1)}'`);
console.log(`'${test2}' -> '${normalize(test2)}'`);
console.log(`'${test3}' -> '${normalize(test3)}'`);
console.log(`'${test4}' -> '${normalize(test4)}'`);
console.log(`'${test5}' -> '${normalize(test5)}'`);
