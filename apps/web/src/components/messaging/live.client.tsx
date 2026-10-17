'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';

import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_LIMITS,
  REALTIME_PATH,
  REALTIME_SERVER_EVENTS,
  realtimeSendSchema,
} from '@minhaj/contracts/messaging';

import {
  LiveComposerContext,
  type LiveComposer,
  type LiveSendInput,
  type LiveSendOutcome,
} from './live-context';
import {
  ackOf,
  caughtUpTo,
  liveAfter,
  mergeLive,
  newestFromOthers,
  realtimeMessageOf,
  realtimeMessagesOf,
  signalOf,
  type LiveMessages,
} from './live-merge';
import { fill, participantAttachmentHref } from './presentation';
import { ThreadItem, ThreadList, type ThreadLabels } from './thread';

/**
 * Live delivery in a person's own conversation — a PROGRESSIVE ENHANCEMENT of
 * the Phase-24 page, never a replacement for it (DELIVERY_PLAN.md Phase 25).
 *
 * THE PAGE WORKS WITHOUT THIS. The server renders the history, the composer
 * is a real form posting to a Server Action, and "Check for new messages"
 * reads the durable catch-up. This island only adds, once the page is
 * interactive: messages appearing as they are committed, sending without a
 * page round trip, the other person's presence and typing, and marking read
 * what has just been shown. With the transport down — or JavaScript off —
 * every one of those falls back to what the page already does, and the
 * status line says so in words.
 *
 * SAME ORIGIN, THE BROWSER'S OWN COOKIE, NOTHING ELSE. The socket connects to
 * this origin's `/socket.io/` (the proxy sends it to the realtime process),
 * WebSocket transport only, carrying the session cookie the browser already
 * holds. No token is read or sent; the server identifies the person from that
 * cookie, re-checks it on every event, and decides every answer from current
 * state. Nothing here decides who may see what.
 *
 * DURABLE TRUTH IS SQL. A message is drawn only from what the server
 * committed: the acknowledgement of this person's own send, a delivery read
 * for them, or a catch-up page. After any (re)connection the island asks the
 * catch-up read for everything after the highest sequence it holds without a
 * hole, page by page, so a message sent during an outage — through the web
 * path, which the transport never fans out — appears exactly once, in order.
 * The merge rules are `live-merge.ts`'s, proved on their own.
 *
 * ONE CONNECTION PER MOUNT, ITS LISTENERS ONCE. The socket object survives its
 * own reconnections, so every listener is attached once, at mount, and each
 * reconnection re-subscribes from the `connect` handler; unmounting removes
 * every listener and closes the socket. Reconnection backs off from one
 * second to a five-second ceiling with ±50% jitter, so a restart of the
 * realtime process is not met by every browser at the same instant.
 *
 * QUIET. One polite live region announces what a person needs to hear — a
 * message from the other person, the transport lost or restored, presence
 * changing — and never each keystroke the other person types; the typing line
 * is visible text only. Nothing animates. Nothing is ever written to the
 * console: a message body never leaves this component except into the page.
 */

export interface LiveLabels {
  readonly connecting: string;
  readonly live: string;
  readonly reconnecting: string;
  readonly unavailable: string;
  /** Contains `{name}`. */
  readonly online: string;
  /** Contains `{name}`. */
  readonly offline: string;
  /** Contains `{name}`. */
  readonly typing: string;
  /** Contains `{name}`. */
  readonly arrived: string;
  readonly more: string;
  readonly reportReload: string;
  readonly you: string;
}

type Status = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable';

interface LiveView {
  readonly status: Status;
  readonly messages: LiveMessages;
  readonly online: boolean | null;
  readonly typing: boolean;
  readonly truncated: boolean;
  readonly announcement: string;
}

const LiveViewContext = createContext<{
  readonly view: LiveView;
  readonly floor: number;
  readonly baseIds: ReadonlySet<string>;
  readonly settings: LiveSettings;
} | null>(null);

interface LiveSettings {
  readonly path: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly counterpart: string;
  readonly presence: boolean;
  readonly labels: LiveLabels;
  readonly thread: ThreadLabels;
}

/** How long one acknowledgement may take before the island stops waiting. */
const ACK_TIMEOUT_MS = 10_000;
/** A send may wait longer: it is a durable commit, and its fallback is a retry. */
const SEND_TIMEOUT_MS = 15_000;
/**
 * Catch-up pages read in one go. Half the per-connection catch-up budget, so a
 * long outage never spends the connection's whole allowance at once; beyond
 * it the page says more are waiting and a reload shows them.
 */
const CATCH_UP_PAGES = Math.floor(REALTIME_LIMITS.budgets.catchUp.max / 2);
/**
 * A typing signal is renewed at most this often — inside the server's TTL, and
 * with its clears, inside the per-connection typing budget.
 */
const TYPING_RENEW_MS = Math.ceil(
  Math.max(
    REALTIME_LIMITS.typingTtlMs / 2,
    (2 * REALTIME_LIMITS.budgets.typing.windowMs) / REALTIME_LIMITS.budgets.typing.max,
  ),
);
/** A typing line nobody renews is cleared here too, should its clear be lost. */
const TYPING_STALE_MS = REALTIME_LIMITS.typingTtlMs + 1_000;
/** Transient subscription refusals are retried this many times, then the line says so. */
const SUBSCRIBE_RETRIES = 3;

/**
 * The answer to a signal nothing waits on — a read mark, a typing change. The
 * transport acts only on an event that carries an acknowledgement, so each
 * carries one; a refusal changes nothing the page shows, and the next mark or
 * keystroke asks again.
 */
function ignoreAck(): void {
  // Deliberately empty: see above.
}

/** An operation identifier the browser mints, where it can. */
export function canMintOperationId(): boolean {
  return typeof globalThis.crypto?.randomUUID === 'function';
}

export function LiveConversation({
  conversationId,
  path,
  floor,
  baseIds,
  locale,
  timeZone,
  counterpart,
  presence,
  labels,
  thread,
  children,
}: {
  readonly conversationId: string;
  /** This conversation's page — where a reload shows every per-message act. */
  readonly path: string;
  /** The newest sequence the server-rendered history shows. */
  readonly floor: number;
  /** The identifiers that history holds. */
  readonly baseIds: readonly string[];
  readonly locale: string;
  /** A real IANA zone, already resolved. */
  readonly timeZone: string;
  /** Who the other side is, as the page names them. */
  readonly counterpart: string;
  /** Show the other person's presence and typing (a direct conversation). */
  readonly presence: boolean;
  readonly labels: LiveLabels;
  readonly thread: ThreadLabels;
  readonly children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [messages, setMessages] = useState<LiveMessages>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [typing, setTyping] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [canSend, setCanSend] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const messagesRef = useRef<LiveMessages>([]);
  const floorRef = useRef(floor);
  const statusRef = useRef<Status>('idle');
  const typingSent = useRef({ active: false, at: 0 });
  const readTo = useRef(floor);
  const labelsRef = useRef({ labels, counterpart });
  const catchUpRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    floorRef.current = floor;
    readTo.current = Math.max(readTo.current, floor);
    labelsRef.current = { labels, counterpart };
  }, [floor, labels, counterpart]);

  const baseSet = useMemo(() => new Set(baseIds), [baseIds]);

  /** Mark read what is now shown — only while the person can actually see it. */
  const markShown = useCallback(() => {
    const socket = socketRef.current;
    if (socket === null || !socket.connected || statusRef.current !== 'live') return;
    if (document.visibilityState !== 'visible') return;
    const shown = caughtUpTo(messagesRef.current, floorRef.current);
    if (newestFromOthers(messagesRef.current, readTo.current) === null) return;
    readTo.current = shown;
    socket.emit(
      REALTIME_CLIENT_EVENTS.read,
      { conversationId, sequence: shown },
      ignoreAck,
    );
  }, [conversationId]);

  useEffect(() => {
    const socket = io({
      path: REALTIME_PATH,
      transports: ['websocket'],
      withCredentials: true,
      // This mount owns its connection: closing it never closes another's.
      forceNew: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.5,
      timeout: ACK_TIMEOUT_MS,
    });
    socketRef.current = socket;
    let disposed = false;
    let catching = false;
    let catchAgain = false;
    let subscribeTries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    let lostOnce = false;

    const announce = (text: string) => {
      // The same sentence twice in a row is still heard: clear, then speak.
      setAnnouncement('');
      setTimeout(() => {
        if (!disposed) setAnnouncement(text);
      }, 50);
    };

    const move = (next: Status) => {
      const previous = statusRef.current;
      if (previous === next) return;
      statusRef.current = next;
      setStatus(next);
      const { labels: words } = labelsRef.current;
      if (next === 'unavailable') announce(words.unavailable);
      else if (next === 'live' && lostOnce) announce(words.live);
      if (next === 'unavailable' || next === 'reconnecting') lostOnce = true;
      if (next !== 'live') {
        setTyping(false);
        typingSent.current = { active: false, at: 0 };
      }
    };

    const apply = (incoming: LiveMessages) => {
      messagesRef.current = mergeLive(messagesRef.current, incoming);
      setMessages(messagesRef.current);
    };

    async function request(event: string, payload: object, timeout = ACK_TIMEOUT_MS) {
      try {
        const answer: unknown = await socket.timeout(timeout).emitWithAck(event, payload);
        return ackOf(answer);
      } catch {
        return { ok: false as const, failure: 'unavailable' };
      }
    }

    async function catchUp() {
      if (catching) {
        catchAgain = true;
        return;
      }
      catching = true;
      try {
        for (let page = 0; ; page += 1) {
          if (page >= CATCH_UP_PAGES) {
            setTruncated(true);
            break;
          }
          const after = caughtUpTo(messagesRef.current, floorRef.current);
          const answer = await request(REALTIME_CLIENT_EVENTS.catchUp, {
            conversationId,
            after,
          });
          if (disposed || !answer.ok) break;
          const found = realtimeMessagesOf(answer.value['messages']);
          apply(found);
          const reached = caughtUpTo(messagesRef.current, floorRef.current);
          if (answer.value['more'] !== true || reached <= after) break;
        }
      } finally {
        catching = false;
      }
      if (disposed) return;
      markShown();
      if (catchAgain) {
        catchAgain = false;
        void catchUp();
      }
    }

    async function subscribe() {
      move('connecting');
      const answer = await request(REALTIME_CLIENT_EVENTS.subscribe, { conversationId });
      if (disposed || !socket.connected) return;
      if (!answer.ok) {
        const transient =
          answer.failure === 'unavailable' || answer.failure === 'rate-limited';
        if (transient && subscribeTries < SUBSCRIBE_RETRIES) {
          subscribeTries += 1;
          retryTimer = setTimeout(
            () => void subscribe(),
            2_000 * subscribeTries * (0.5 + Math.random()),
          );
          return;
        }
        // Not this person's to follow now (signed out, ended, refused): no
        // retry would change that. The page still works; the line says so.
        socket.disconnect();
        move('unavailable');
        return;
      }
      subscribeTries = 0;
      setCanSend(answer.value['canSend'] === true);
      setOnline(answer.value['counterpartOnline'] === true);
      move('live');
      await catchUp();
    }

    catchUpRef.current = () => void catchUp();
    const onConnect = () => void subscribe();
    const onDisconnect = (reason: Socket.DisconnectReason) => {
      setOnline(null);
      setCanSend(false);
      if (reason === 'io client disconnect') return;
      move(socket.active ? 'reconnecting' : 'unavailable');
    };
    const onConnectError = () => move('unavailable');

    const onMessage = (payload: unknown) => {
      const signal = signalOf(payload, conversationId);
      if (signal === null) return;
      const message = realtimeMessageOf(signal['message']);
      if (message === null) return;
      const before = caughtUpTo(messagesRef.current, floorRef.current);
      const known = messagesRef.current.some((entry) => entry.id === message.id);
      apply([message]);
      if (message.sequence > before + 1) void catchUp();
      if (!message.own && !known && message.sequence > floorRef.current) {
        setTyping(false);
        announce(
          fill(labelsRef.current.labels.arrived, { name: labelsRef.current.counterpart }),
        );
      }
      markShown();
    };
    const onPresence = (payload: unknown) => {
      const signal = signalOf(payload, conversationId);
      if (signal === null || typeof signal['online'] !== 'boolean') return;
      const next = signal['online'];
      setOnline((previous) => {
        if (previous !== null && previous !== next) {
          const { labels: words, counterpart: name } = labelsRef.current;
          announce(fill(next ? words.online : words.offline, { name }));
        }
        return next;
      });
      if (!next) setTyping(false);
    };
    const onTyping = (payload: unknown) => {
      const signal = signalOf(payload, conversationId);
      if (signal === null || typeof signal['typing'] !== 'boolean') return;
      const active = signal['typing'];
      setTyping(active);
      clearTimeout(typingTimer);
      if (active) typingTimer = setTimeout(() => setTyping(false), TYPING_STALE_MS);
    };
    const onVisible = () => markShown();

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on(REALTIME_SERVER_EVENTS.messageCreated, onMessage);
    socket.on(REALTIME_SERVER_EVENTS.presenceChanged, onPresence);
    socket.on(REALTIME_SERVER_EVENTS.typingChanged, onTyping);
    document.addEventListener('visibilitychange', onVisible);
    move('connecting');
    socket.connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(typingTimer);
      document.removeEventListener('visibilitychange', onVisible);
      socket.off();
      socket.disconnect();
      socketRef.current = null;
      catchUpRef.current = () => undefined;
      statusRef.current = 'idle';
    };
  }, [conversationId, markShown]);

  const ready = status === 'live' && canSend && canMintOperationId();

  const send = useCallback(
    async (input: LiveSendInput): Promise<LiveSendOutcome> => {
      const socket = socketRef.current;
      const payload = {
        conversationId,
        operationId: input.operationId,
        body: input.body,
        attachmentIds: [...input.attachmentIds],
      };
      // Anything the transport would refuse as malformed goes to the web
      // path, which words its own answer exactly as it always has.
      if (socket === null || !socket.connected || statusRef.current !== 'live')
        return { state: 'unsent' };
      if (!realtimeSendSchema.safeParse(payload).success) return { state: 'unsent' };
      // Sending clears the person's typing on the server; mirror it here.
      typingSent.current = { active: false, at: 0 };
      let answer: unknown;
      try {
        answer = await socket
          .timeout(SEND_TIMEOUT_MS)
          .emitWithAck(REALTIME_CLIENT_EVENTS.send, payload);
      } catch {
        return { state: 'unsent' };
      }
      const outcome = ackOf(answer);
      if (!outcome.ok)
        return outcome.failure === 'unavailable' || outcome.failure === 'signed-out'
          ? { state: 'unsent' }
          : { state: 'refused', failure: outcome.failure };
      const message = realtimeMessageOf(outcome.value['message']);
      if (message !== null) {
        const before = caughtUpTo(messagesRef.current, floorRef.current);
        messagesRef.current = mergeLive(messagesRef.current, [message]);
        setMessages(messagesRef.current);
        // Something was committed between what is shown and this message (the
        // other person wrote through the web path): the durable read fills it.
        if (message.sequence > before + 1) catchUpRef.current();
      }
      return { state: 'sent' };
    },
    [conversationId],
  );

  const signalTyping = useCallback(
    (active: boolean) => {
      const socket = socketRef.current;
      const sent = typingSent.current;
      if (socket === null || !socket.connected || statusRef.current !== 'live') {
        typingSent.current = { active: false, at: 0 };
        return;
      }
      const now = Date.now();
      if (active) {
        if (now - sent.at < TYPING_RENEW_MS) return;
        typingSent.current = { active: true, at: now };
        socket.emit(
          REALTIME_CLIENT_EVENTS.typing,
          { conversationId, typing: true },
          ignoreAck,
        );
        return;
      }
      if (!sent.active) return;
      typingSent.current = { active: false, at: sent.at };
      socket.emit(
        REALTIME_CLIENT_EVENTS.typing,
        { conversationId, typing: false },
        ignoreAck,
      );
    },
    [conversationId],
  );

  const composer = useMemo<LiveComposer>(
    () => ({ ready, send, typing: signalTyping }),
    [ready, send, signalTyping],
  );

  const settings = useMemo<LiveSettings>(
    () => ({ path, locale, timeZone, counterpart, presence, labels, thread }),
    [path, locale, timeZone, counterpart, presence, labels, thread],
  );

  const view = useMemo(
    () => ({
      view: { status, messages, online, typing, truncated, announcement },
      floor,
      baseIds: baseSet,
      settings,
    }),
    [status, messages, online, typing, truncated, announcement, floor, baseSet, settings],
  );

  return (
    <LiveViewContext.Provider value={view}>
      <LiveComposerContext.Provider value={composer}>
        {children}
      </LiveComposerContext.Provider>
    </LiveViewContext.Provider>
  );
}

/**
 * The thread's list: the server-rendered history (`children`) and, after it,
 * whatever arrived live that the history does not already hold.
 */
export function LiveThread({
  label,
  empty,
  children,
}: {
  readonly label: string;
  /** What the page shows when there is no message at all. */
  readonly empty: ReactNode;
  /** The server-rendered items, or nothing when the history is empty. */
  readonly children?: ReactNode;
}) {
  const live = useContext(LiveViewContext);
  const added =
    live === null ? [] : liveAfter(live.view.messages, live.floor, live.baseIds);
  if (children === undefined && added.length === 0) return <>{empty}</>;
  return (
    <ThreadList label={label}>
      {children}
      {live === null
        ? null
        : added.map((message) => {
            const { labels, thread, counterpart, locale, timeZone, path } = live.settings;
            return (
              <ThreadItem
                key={message.id}
                message={{
                  id: message.id,
                  sequence: message.sequence,
                  own: message.own,
                  sender: message.own ? labels.you : counterpart,
                  body: message.body,
                  withheld: message.withheld,
                  sentAt: new Date(message.sentAt),
                  attachments: message.attachments,
                }}
                labels={thread}
                attachmentHref={participantAttachmentHref}
                locale={locale}
                timeZone={timeZone}
                after={
                  message.own || message.withheld ? null : (
                    <p className="text-sm">
                      <a
                        href={path}
                        className="inline-flex min-h-11 items-center font-medium text-[color:var(--color-action)] underline underline-offset-2"
                      >
                        {labels.reportReload}
                      </a>
                    </p>
                  )
                }
              />
            );
          })}
    </ThreadList>
  );
}

/**
 * Where the live connection stands, in words — and the other person's presence
 * and typing, as text. Nothing at all before the page is interactive: a page
 * without JavaScript has no live connection to describe.
 */
export function LiveStatus() {
  const live = useContext(LiveViewContext);
  if (live === null) return null;
  const { status, online, typing, truncated, announcement } = live.view;
  const { labels, counterpart, presence } = live.settings;
  const name = { name: counterpart };
  const line =
    status === 'live'
      ? labels.live
      : status === 'reconnecting'
        ? labels.reconnecting
        : status === 'unavailable'
          ? labels.unavailable
          : status === 'connecting'
            ? labels.connecting
            : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm wrap-anywhere">
      {line === null ? null : <p data-live-status={status}>{line}</p>}
      {presence && status === 'live' && online !== null ? (
        <p data-live-presence={online ? 'online' : 'offline'}>
          {fill(online ? labels.online : labels.offline, name)}
        </p>
      ) : null}
      {presence && status === 'live' && typing ? (
        <p data-live-typing="">{fill(labels.typing, name)}</p>
      ) : null}
      {truncated ? <p>{labels.more}</p> : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
