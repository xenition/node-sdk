export interface RealtimeMessage<T = unknown> {
    channel: string;
    payload: T;
    at: string;
}
export type RealtimeHandler<T = unknown> = (message: RealtimeMessage<T>) => void;
export interface Subscription {
    unsubscribe: () => void;
}
//# sourceMappingURL=types.d.ts.map