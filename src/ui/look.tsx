// The game's look: fonts, gradients, glossy buttons and panels, icons, a living background and entrance animations.
// Everything here is plain React Native and react-native-svg, so it ships over the air.
import * as Haptics from 'expo-haptics';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export const ND = Platform.OS !== 'web';

/** The display font: rounded and friendly. Body copy stays in the system font. */
export const F = { bold: 'Fredoka_700Bold', semi: 'Fredoka_600SemiBold', med: 'Fredoka_500Medium' };

/** A light tap on the phone for buttons and tabs. */
export function haptic(kind: 'light' | 'medium' | 'select' = 'light') {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'select') Haptics.selectionAsync();
    else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  } catch { /* no haptics on this device */ }
}

let gradId = 0;
const useGradId = () => useMemo(() => `hg${++gradId}`, []);

/** Splits a colour into an opaque colour and its alpha. iOS ignores alpha inside gradient stops, so it goes in
 *  stopOpacity instead. Handles #rrggbbaa and rgba(). */
export function splitAlpha(c: string): [string, number] {
  const m = c.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (m) return [`rgb(${m[1]},${m[2]},${m[3]})`, Number(m[4])];
  if (/^#[0-9a-f]{8}$/i.test(c)) return [c.slice(0, 7), parseInt(c.slice(7), 16) / 255];
  return [c, 1];
}

/**
 * Fills its parent and hands its children the real size in points. Vector drawings sized in percent don't
 * always follow their parent on iOS (a pill sized by its text could end up half-painted), so anything that
 * must fill a box is drawn at the measured size instead.
 */
export function Measured({ style, children, fallback }: { style?: ViewStyle | ViewStyle[]; children: (w: number, h: number) => React.ReactNode; fallback?: string }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style as ViewStyle, !box && fallback ? { backgroundColor: fallback } : null]}
      onLayout={e => { const { width: w, height: h } = e.nativeEvent.layout; setBox(b => (b && Math.abs(b.w - w) < 0.5 && Math.abs(b.h - h) < 0.5 ? b : { w, h })); }}>
      {box && box.w > 0 && box.h > 0 ? children(box.w, box.h) : null}
    </View>
  );
}

/** A gradient filling its parent. */
export const Grad = memo(function Grad({ colors, radius = 0, horizontal, style, opacity = 1 }: { colors: string[]; radius?: number; horizontal?: boolean; style?: ViewStyle; opacity?: number }) {
  const id = useGradId();
  return (
    <Measured style={style} fallback={colors[colors.length - 1]}>
      {(w, h) => (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
              {colors.map((c, i) => { const [col, a] = splitAlpha(c); return <Stop key={i} offset={colors.length === 1 ? 0 : i / (colors.length - 1)} stopColor={col} stopOpacity={a} />; })}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} rx={radius} ry={radius} fill={`url(#${id})`} opacity={opacity} />
        </Svg>
      )}
    </Measured>
  );
});

/** A soft round glow filling its parent, brightest in the middle. */
export const Glow = memo(function Glow({ color, opacity = 0.6, cx = '50%', cy = '50%', r = '50%', style }: { color: string; opacity?: number; cx?: string; cy?: string; r?: string; style?: ViewStyle }) {
  const id = useGradId();
  const [col, a] = splitAlpha(color);
  return (
    <Measured style={style}>
      {(w, h) => (
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient id={id} cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
              <Stop offset="0" stopColor={col} stopOpacity={opacity * a} />
              <Stop offset="1" stopColor={col} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
        </Svg>
      )}
    </Measured>
  );
});

/** Panel colours. */
export const PANEL = ['#352a60', '#271e48'];
export const shadow = (color = '#000', r = 10, o = 0.35, y = 4): ViewStyle => ({
  shadowColor: color, shadowOpacity: o, shadowRadius: r, shadowOffset: { width: 0, height: y }, elevation: Math.round(r / 2),
});

/** Fades and slides its children in when it first appears. */
export function FadeIn({ children, delay = 0, dy = 14, style }: { children: React.ReactNode; delay?: number; dy?: number; style?: ViewStyle }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(t, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: ND });
    a.start();
    return () => a.stop();
  }, [t, delay]);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** A springy press: shrinks a touch while held, then bounces back. Returns handlers and the scale to apply. */
export function usePress(depth = 0.96) {
  const v = useRef(new Animated.Value(0)).current;
  return {
    scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, depth] }),
    v,
    onPressIn: () => Animated.spring(v, { toValue: 1, speed: 50, bounciness: 0, useNativeDriver: ND }).start(),
    onPressOut: () => Animated.spring(v, { toValue: 0, speed: 18, bounciness: 10, useNativeDriver: ND }).start(),
  };
}

/** A slow, endless 0..1 loop. */
export function useLoop(ms: number, run = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return;
    v.setValue(0);
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: ND }));
    l.start();
    return () => l.stop();
  }, [v, ms, run]);
  return v;
}
export const pulse = (v: Animated.Value, lo: number, hi: number) => v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [lo, hi, lo] });

// ---------------------------------------------------------------------------------------------------------------
// Icons, drawn on a 24x24 grid.

export type IconName = 'sword' | 'paw' | 'egg' | 'heart' | 'compass' | 'coin' | 'gem' | 'lock' | 'check' | 'star' | 'skull' | 'tower' | 'bag' | 'scan' | 'dna' | 'bolt' | 'shield' | 'crown' | 'sparkle' | 'chest';
export const Icon = memo(function Icon({ name, size = 22, color = '#fff', accent }: { name: IconName; size?: number; color?: string; accent?: string }) {
  const a = accent ?? color;
  let body: React.ReactNode;
  switch (name) {
    case 'sword': body = (<>
      <Path d="M20.5 2.5 L21.5 3.5 L21 6.5 L11.2 16.3 L7.7 12.8 L17.5 3Z" fill={color} />
      <Path d="M5.2 11.8 L12.2 18.8 L10.8 20.2 L3.8 13.2Z" fill={color} />
      <Path d="M8.6 16.4 L4.6 20.4" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
      <Path d="M19.6 4.4 L10.6 13.4" stroke={a} strokeWidth="1.1" strokeLinecap="round" opacity={0.6} />
    </>); break;
    case 'paw': body = (<>
      <Ellipse cx="12" cy="16" rx="5.2" ry="4.4" fill={color} />
      <Ellipse cx="6" cy="10.5" rx="2.1" ry="2.6" fill={color} /><Ellipse cx="10" cy="6.8" rx="2.1" ry="2.7" fill={color} />
      <Ellipse cx="14.2" cy="6.8" rx="2.1" ry="2.7" fill={color} /><Ellipse cx="18.2" cy="10.5" rx="2.1" ry="2.6" fill={color} />
    </>); break;
    case 'egg': body = (<>
      <Path d="M12 2.5 C16.5 2.5 19.5 9 19.5 14 C19.5 18.5 16.3 21.5 12 21.5 C7.7 21.5 4.5 18.5 4.5 14 C4.5 9 7.5 2.5 12 2.5Z" fill={color} />
      <Path d="M6 13.5 L8.5 11.5 L11 14 L13.5 11.5 L16 14 L18.3 12" stroke={a} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </>); break;
    case 'heart': body = <Path d="M12 20.5 C5 15.5 2.5 12.2 2.5 8.6 C2.5 5.6 4.8 3.5 7.6 3.5 C9.5 3.5 11 4.6 12 6.2 C13 4.6 14.5 3.5 16.4 3.5 C19.2 3.5 21.5 5.6 21.5 8.6 C21.5 12.2 19 15.5 12 20.5Z" fill={color} />; break;
    case 'compass': body = (<>
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2.2" />
      <Path d="M15.5 8.5 L13.2 13.2 L8.5 15.5 L10.8 10.8Z" fill={a} />
    </>); break;
    case 'coin': body = (<>
      <Circle cx="12" cy="12" r="10" fill="#e9a91f" /><Circle cx="12" cy="11.2" r="9.2" fill="#ffd34d" />
      <Circle cx="12" cy="11.2" r="6.2" fill="none" stroke="#e9a91f" strokeWidth="1.6" />
      <Path d="M7.5 7 Q9.5 4.8 12.5 4.6" stroke="#fff6c9" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>); break;
    case 'gem': body = (<>
      <Path d="M6 3.5 H18 L22 9 L12 21.5 L2 9Z" fill="#8f6cff" />
      <Path d="M6 3.5 H18 L22 9 H2Z" fill="#c2b0ff" /><Path d="M9 9 L12 21.5 L15 9Z" fill="#a98cff" />
      <Path d="M8 5 L10 8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </>); break;
    case 'lock': body = (<>
      <Path d="M7.5 10 V7.5 A4.5 4.5 0 0 1 16.5 7.5 V10" stroke={color} strokeWidth="2.4" fill="none" />
      <Rect x="4.5" y="10" width="15" height="11" rx="3" fill={color} /><Circle cx="12" cy="15" r="1.8" fill={a} />
    </>); break;
    case 'check': body = <Path d="M4 12.5 L9.5 18 L20 6.5" stroke={color} strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />; break;
    case 'star': body = <Path d="M12 2.5 L14.8 8.6 L21.5 9.3 L16.5 13.8 L17.9 20.5 L12 17.1 L6.1 20.5 L7.5 13.8 L2.5 9.3 L9.2 8.6Z" fill={color} />; break;
    case 'skull': body = (<>
      <Path d="M12 2.5 C17 2.5 20.5 6 20.5 10.5 C20.5 13.5 19 15.5 17 16.5 V20 H7 V16.5 C5 15.5 3.5 13.5 3.5 10.5 C3.5 6 7 2.5 12 2.5Z" fill={color} />
      <Circle cx="8.6" cy="11" r="2.3" fill={a} /><Circle cx="15.4" cy="11" r="2.3" fill={a} />
    </>); break;
    case 'tower': body = (<>
      <Path d="M6 21 V9 H18 V21Z" fill={color} /><Path d="M5 9 V4.5 H7.5 V6.5 H10 V4.5 H14 V6.5 H16.5 V4.5 H19 V9Z" fill={color} />
      <Path d="M10 21 V16 A2 2 0 0 1 14 16 V21Z" fill={a} />
    </>); break;
    case 'bag': body = (<>
      <Path d="M8.5 8 V6.5 A3.5 3.5 0 0 1 15.5 6.5 V8" stroke={color} strokeWidth="2.2" fill="none" />
      <Path d="M4.5 8 H19.5 L18.5 21 H5.5Z" fill={color} />
    </>); break;
    case 'scan': body = (<>
      <Circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke={color} strokeWidth="2.4" />
      <Path d="M15.5 15.5 L21 21" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </>); break;
    case 'dna': body = (<>
      <Path d="M7 3 C7 9 17 9 17 15 C17 18 15 20 15 21 M17 3 C17 9 7 9 7 15 C7 18 9 20 9 21" stroke={color} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <Path d="M8.5 6 H15.5 M8.5 18 H15.5" stroke={a} strokeWidth="1.8" strokeLinecap="round" />
    </>); break;
    case 'bolt': body = <Path d="M13.5 2.5 L5 13.5 H11 L10 21.5 L19 10 H13Z" fill={color} />; break;
    case 'shield': body = <Path d="M12 2.5 L20 5.5 V11 C20 16 16.5 19.5 12 21.5 C7.5 19.5 4 16 4 11 V5.5Z" fill={color} />; break;
    case 'crown': body = <Path d="M3 8 L7.5 12 L12 5 L16.5 12 L21 8 L19 19 H5Z" fill={color} />; break;
    case 'sparkle': body = <Path d="M12 2 Q13 11 22 12 Q13 13 12 22 Q11 13 2 12 Q11 11 12 2Z" fill={color} />; break;
    case 'chest': body = (<>
      <Path d="M3 10 Q3 4.5 12 4.5 Q21 4.5 21 10Z" fill={color} /><Rect x="3" y="10" width="18" height="10" rx="1.5" fill={color} />
      <Rect x="10.5" y="8.5" width="3" height="4.5" rx="1" fill={a} />
    </>); break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
});

// ---------------------------------------------------------------------------------------------------------------
// The living background behind the menus: a deep gradient, a soft glow tinted for each tab, and motes drifting up.

const MOTES = Array.from({ length: 14 }, (_, i) => ({ x: (i * 37 + 11) % 100, s: 2 + (i % 3), d: 9000 + ((i * 1733) % 7000), o: (i * 0.137) % 1 }));
const Mote = memo(function Mote({ x, s, d, o, H, color }: { x: number; s: number; d: number; o: number; H: number; color: string }) {
  const t = useLoop(d);
  const p = t.interpolate({ inputRange: [0, 1], outputRange: [o, o + 1] });
  const frac = p.interpolate({ inputRange: [0, 1, 1.0001, 2], outputRange: [0, 1, 0, 1] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: `${x}%`, top: 0, width: s * 2, height: s * 2, borderRadius: s, backgroundColor: color,
      opacity: frac.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.55, 0.55, 0] }),
      transform: [{ translateY: frac.interpolate({ inputRange: [0, 1], outputRange: [H * 0.95, H * 0.15] }) }, { translateX: frac.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 12, -4] }) }],
    }} />
  );
});

export const Backdrop = memo(function Backdrop({ tint, H }: { tint: string; H: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: ND }).start();
  }, [tint, fade]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Grad colors={['#2b2054', '#1a1335', '#0f0a1e']} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Glow color={tint} opacity={0.32} cx="85%" cy="8%" r="70%" />
        <Glow color={tint} opacity={0.16} cx="5%" cy="75%" r="60%" />
      </Animated.View>
      {MOTES.map((m, i) => <Mote key={i} {...m} H={H} color={i % 3 ? '#e9e1ff' : tint} />)}
    </View>
  );
});
