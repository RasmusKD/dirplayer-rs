import {
  ICastMemberRef,
  JsBridgeBreakpoint,
  OnScriptErrorData,
  loadExternalXtra,
  registerVmCallbacks,
  resolveAndLoadMovieXtras,
  setXtraRegistry,
  getXtraRegistry,
} from "dirplayer-js-api";
import { createFlashInstance, destroyFlashInstance, destroyAllFlashInstances, initFlashBridge } from "../services/flashPlayerManager";
import store from "../store";
import { breakpointListChanged, castLibNameChanged, castListChanged, castMemberChanged, castMemberListChanged, channelChanged, channelDisplayNameChanged, channelDisplayNamesChanged, datumSnapshot, debugContentAdded, debugMessageAdded, debugMessagesCleared, frameChanged, globalsChanged, movieLoaded, movieLoadFailed, onScriptError, removeTimeoutHandle, scopeListChanged, scoreChanged, scriptErrorCleared, scriptInstanceSnapshot, setTimeoutHandle } from "../store/vmSlice";
import { OnMovieLoadedCallbackData, trigger_timeout, exportW3dObj, exportW3dRaw, listW3dMembers, get_breakpoints, set_lingo_global, get_lingo_global, get_sprite_info, set_blanked_members, get_film_loop_dump, get_film_loop_layout, get_film_loop_inner_layout, get_film_loop_traces, set_text_replacements, set_film_loop_trace, set_paused, is_paused, eval_command, player_print_member_bitmap_hex, get_score_details } from 'vm-rust'
import { DatumRef, IVMScope, JsBridgeDatum, MemberSnapshot, ScoreSnapshot, ScoreSpriteSnapshot } from ".";
import { onMemberSelected } from "../store/uiSlice";
import { isUIShown } from "../utils/debug";

export function clearAllTimeouts() {
  const handles = store.getState().vm.timeoutHandles;
  Object.keys(handles).forEach((key) => {
    clearInterval(handles[key] as Parameters<typeof clearInterval>[0]);
    store.dispatch(removeTimeoutHandle(key));
  });
}

export function initVmCallbacks() {
  // Initialize the Flash/Ruffle bridge (registers global JS functions for WASM to call)
  initFlashBridge();

  // Expose W3D debug tools on window for console access
  (window as any).exportW3dObj = exportW3dObj;
  (window as any).exportW3dRaw = exportW3dRaw;
  (window as any).listW3dMembers = listW3dMembers;

  // Expose external xtra loader + registry API so hosts (or devtools)
  // can drive plugin loading interactively. Namespaced with `dirplayer_`
  // so DevTools autocomplete groups them together and they don't
  // collide with anything a host page or extension might already put on
  // window. The dev-environment auto-load that runs at boot lives in
  // VMProvider (after `await init`); these exposures are for ad-hoc
  // testing.
  //
  //   await dirplayer_loadExternalXtra('/example_xtra.wasm')
  //   dirplayer_setXtraRegistry({ BobbaXtra: '~/bobba.wasm' })
  //   await dirplayer_resolveAndLoadMovieXtras()
  //   dirplayer_getXtraRegistry()
  const w = window as any;
  w.dirplayer_loadExternalXtra = loadExternalXtra;
  w.dirplayer_setXtraRegistry = setXtraRegistry;
  w.dirplayer_getXtraRegistry = getXtraRegistry;
  w.dirplayer_resolveAndLoadMovieXtras = resolveAndLoadMovieXtras;
  // Projector-wrapper replication: lets a host page seed Lingo globals the
  // way a projector's embedded startup movie would (e.g. HSprog for
  // "Matematik i Maaneby+"), and read them back for diagnostics.
  //   dirplayer_setLingoGlobal('HSprog', 'SV')
  //   dirplayer_getLingoGlobal('sSprog')
  w.dirplayer_setLingoGlobal = set_lingo_global;
  w.dirplayer_getLingoGlobal = get_lingo_global;
  // Sprite state as JSON, for diagnosing a wrong-looking channel
  // (member, position, size vs the member's intrinsic size, stretch,
  // and any text) without guessing from a screenshot.
  //   JSON.parse(dirplayer_getSpriteInfo(10))
  w.dirplayer_getSpriteInfo = get_sprite_info;
  w.dirplayer_getScoreDetails = get_score_details;
  w.dirplayer_getFilmLoopDump = get_film_loop_dump;
  w.dirplayer_getFilmLoopLayout = get_film_loop_layout;
  w.dirplayer_setTextReplacements = set_text_replacements;
  w.dirplayer_getFilmLoopTraces = get_film_loop_traces;
  // The film loop layout trace is OFF by default: it runs inside the render
  // loop, so building it every frame cost real time for a string nothing
  // read. Turn it on, reproduce, then read the traces.
  //   dirplayer_setFilmLoopTrace(true)
  w.dirplayer_setFilmLoopTrace = set_film_loop_trace;
  // Real pause: holds the frame loop between frames, so the playhead,
  // timers and sound stay put and resuming is instant.
  //   dirplayer_setPaused(true)
  w.dirplayer_setPaused = set_paused;
  w.dirplayer_isPaused = is_paused;
  // Measuring hooks. `evalCommand` runs a line of Lingo against the live
  // movie (the same path the debugger uses), which lets a probe change one
  // property of one sprite and re-measure, instead of rebuilding the engine
  // to test a hypothesis. `printMemberBitmapHex` dumps a bitmap member's RGBA
  // to the console so its pixels can be compared against the projector's.
  w.dirplayer_evalCommand = eval_command;
  w.dirplayer_printMemberBitmapHex = player_print_member_bitmap_hex;
  w.dirplayer_getFilmLoopInnerLayout = get_film_loop_inner_layout;
  // Members whose text must never be drawn (see set_blanked_members).
  //   dirplayer_setBlankedMembers(['LicensTXT'])
  w.dirplayer_setBlankedMembers = set_blanked_members;

  // Expose trace log download on window
  (window as any).downloadTraceLog = () => {
    try {
      // Dynamic import to avoid TS type issues before rebuild
      const vm = require('vm-rust');
      const log = vm.get_trace_log?.();
      if (!log) {
        console.log('No trace log available (traceLogFile not set or empty)');
        return;
      }
      const blob = new Blob([log.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileName = log.path.split(/[/\\]/).pop() || 'trace.log';
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`Downloaded trace log: ${fileName} (${log.content.length} bytes)`);
    } catch (e) {
      console.error('Failed to download trace log:', e);
    }
  };

  registerVmCallbacks({
    onMovieLoaded: (result: OnMovieLoadedCallbackData) => {
      // Offer trace log download if one was recorded
      try {
        const vm = require('vm-rust');
        const log = vm.get_trace_log?.();
        if (log && log.content.length > 0) {
          const fileName = log.path.split(/[/\\]/).pop() || 'trace.log';
          console.log(`Trace log available: ${fileName} (${log.content.length} bytes) - call downloadTraceLog() to save`);
        }
      } catch {}
      store.dispatch(debugMessagesCleared());
      store.dispatch(movieLoaded());
      // Re-mirror the VM's breakpoints. `movieUnloaded` resets the vm slice to
      // its initial state, which empties the store's copy, but the VM keeps the
      // list it was given (restored from localStorage at boot) and nothing
      // pushes it again. The script gutter therefore came up blank after a
      // movie load even though the breakpoints were live, and only reappeared
      // when the next add/remove finally sent a list.
      store.dispatch(breakpointListChanged(get_breakpoints() as JsBridgeBreakpoint[]));
    },
    onMovieLoadFailed: (path: string, error: string) => {
      store.dispatch(movieLoadFailed(`Failed to load movie: ${error}`));
    },
    onCastListChanged: (castList: string[]) => {
      store.dispatch(castListChanged(castList));
    },
    onCastLibNameChanged: (castNumber: number, name: string) => {
      store.dispatch(castLibNameChanged({ castNumber, name }))
    },
    onCastMemberListChanged: (castNumber: number, members: any) => {
      store.dispatch(castMemberListChanged({ 
        castNumber, 
        members,
      }))
    },
    onCastMemberChanged: (memberRef: ICastMemberRef, snapshot: MemberSnapshot) => {
      store.dispatch(castMemberChanged({ memberRef, snapshot }))
    },
    onFrameChanged: (frame: number) => {
      store.dispatch(frameChanged(frame))
    },
    onScoreChanged: (snapshot: ScoreSnapshot) => {
      store.dispatch(scoreChanged({
        ...snapshot,
      }))
    },
    onScriptError: (errorObj: OnScriptErrorData) => {
      if (!isUIShown()) {
        alert(`Script error: ${errorObj.message}`);
      }
      store.dispatch(onScriptError(errorObj.message))
      store.dispatch(onMemberSelected(errorObj.script_member_ref))
    },
    onScopeListChanged: (scopes: IVMScope[]) => {
      store.dispatch(scopeListChanged(scopes))
    },
    onBreakpointListChanged: (breakpoints: JsBridgeBreakpoint[]) => {
      store.dispatch(breakpointListChanged(breakpoints))
      // Defensive dedup before persisting: guards against the breakpoint list
      // ever ballooning with duplicates (the WASM side also dedups in
      // add_breakpoint). Key on script + handler + bytecode index.
      const seen = new Set<string>()
      const unique = breakpoints.filter((bp) => {
        const k = `${bp.script_name}|${bp.handler_name}|${bp.bytecode_index}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      window.localStorage.setItem('breakpoints', JSON.stringify(unique))
    },
    onScriptErrorCleared: () => {
      store.dispatch(scriptErrorCleared())
    },
    onGlobalListChanged: (globals: Record<string, any>) => {
      store.dispatch(globalsChanged(globals))
    },
    onDebugMessage: (message: string) => {
      console.log(message);
      store.dispatch(debugMessageAdded(message));
    },
    onDebugContent: (content) => {
      store.dispatch(debugContentAdded(content));
    },
    onScheduleTimeout: (timeoutName: string, periodMs: number) => {
      // Handles are keyed by name, so a re-schedule under a live name would
      // orphan the previous interval — it keeps firing with no way to reach it.
      const previous = store.getState().vm.timeoutHandles[timeoutName];
      if (previous) {
        clearInterval(previous as Parameters<typeof clearInterval>[0]);
      }
      const handle = setInterval(() => {
        trigger_timeout(timeoutName)
      }, periodMs);
      store.dispatch(setTimeoutHandle({ name: timeoutName, handle }))
    },
    onClearTimeout: (timeoutName: string) => {
      const handle = store.getState().vm.timeoutHandles[timeoutName];
      if (handle) {
        clearInterval(handle as Parameters<typeof clearInterval>[0]);
        store.dispatch(removeTimeoutHandle(timeoutName))
      }
    },
    onClearAllTimeouts: () => {
      clearAllTimeouts();
      console.log("Cleared all timeouts");
    },
    onDatumSnapshot: (datumRef: DatumRef, datum: JsBridgeDatum) => {
      store.dispatch(datumSnapshot({ datumRef, datum }));
    },
    onScriptInstanceSnapshot: (scriptInstanceId: number, scriptInstance: JsBridgeDatum) => {
      store.dispatch(scriptInstanceSnapshot({ scriptInstanceId, datum: scriptInstance }));
    },
    onChannelChanged: (channelNumber: number, channelData: ScoreSpriteSnapshot) => {
      store.dispatch(channelChanged({ channelNumber, channelData }))
    },
    onChannelDisplayNameChanged: (channelNumber: number, displayName: string) => {
      store.dispatch(channelDisplayNameChanged({ channelNumber, displayName }));
    },
    onChannelDisplayNamesChanged: (names: Record<number, string>) => {
      store.dispatch(channelDisplayNamesChanged(names));
    },
    onFlashMemberLoaded: (spriteNum: number, castLib: number, castMember: number, swfData: Uint8Array, width: number, height: number, pausedAtStart: boolean, assertedFrame: number) => {
      // Copy immediately - swfData is a view into WASM memory that may be invalidated
      const swfDataCopy = new Uint8Array(swfData);
      console.log(`Flash member loaded: sprite#${spriteNum} ${castLib}:${castMember} ${width}x${height} (${swfDataCopy.length} bytes, first=[${Array.from(swfDataCopy.slice(0, 4)).join(',')}], pausedAtStart=${pausedAtStart}, assertedFrame=${assertedFrame})`);
      createFlashInstance(spriteNum, castLib, castMember, swfDataCopy, width, height, pausedAtStart, assertedFrame)
        .catch(e => console.error('Failed to create Flash instance:', e));
    },
    onFlashMemberUnloaded: (spriteNum: number) => {
      destroyFlashInstance(spriteNum);
    },
    onFlashResetAll: () => {
      destroyAllFlashInstances();
    },
    onStageSizeChanged: (width: number, height: number, center: boolean) => {
      const inner = document.getElementById('stage_canvas_container');
      if (inner) {
        inner.style.width = `${width}px`;
        inner.style.height = `${height}px`;
        const outer = inner.parentElement;
        if (outer) {
          outer.dataset.centerStage = center ? 'true' : 'false';
          outer.style.justifyContent = center ? 'center' : 'flex-start';
          outer.style.alignItems = center ? 'center' : 'flex-start';
        }
      }
    },
  });
}
