export function sleepms(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}