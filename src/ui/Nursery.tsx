// Incubators, eggs and breeding. Also the hatch reveal: stars first, then the creature.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { SfxName, sfx } from './audio';
import { ELEMENTS } from '../game/data/elements';
import { Creature, Egg, STAGE_NAMES, stageLevels, stageOf, typeLabel } from '../game/creature';
import { BreedMats, INC_SLOT_COST, INC_UPGRADE, MAT_COST, breedCost, breedProblem, discardEgg, doBreed, eggValue, fillIncubators, forecast, hatchAll, hatchEgg, incubationMs, placeEgg, speedUp, speedUpCost, buyIncubator, upgradeIncubator } from '../game/economy';
import { SKELETON_NAMES, express, starRating } from '../game/genome';
import { TUT } from '../game/save';
import { Bar, Breathing, Btn, C, Card, CreatureTile, CreatureView, EggView, H, LiveCreature, Mark, P, SexMark, Stars, Title, TypeChips, mixHex, st } from './kit';
import { F, FadeIn, Glow, Grad, Icon, IconName, ND, haptic, pulse, shadow, useLoop, usePress } from './look';
import { CreatureDetail } from './Roster';
import { fmtTime, rng, useGame, useNow } from './store';

const CRACKS = [
  '',
  'M50 26 L46 34 L52 40 L47 48',
  'M50 26 L46 34 L52 40 L47 48 L40 55 L44 62 M52 40 L61 45 L58 53',
  'M50 26 L46 34 L52 40 L47 48 L40 55 L44 62 L36 68 M52 40 L61 45 L58 53 L66 60 M47 48 L54 58 L50 66',
];
const TAPS = 3;

/** Several eggs hatching at once: each hatchling pops in on its own card, one after another. */
function HatchAllReveal({ cs, onClose }: { cs: Creature[]; onClose: () => void }) {
  const { width: W } = useWindowDimensions();
  const pops = useRef(cs.map(() => new Animated.Value(0))).current;
  const [done, setDone] = useState(false);
  useEffect(() => {
    const ts = cs.map((c, i) => setTimeout(() => {
      sfx(i === 0 ? 'crackBig' : 'hatch');
      haptic('medium');
      Animated.spring(pops[i], { toValue: 1, friction: 5, tension: 90, useNativeDriver: ND }).start();
      if (i === cs.length - 1) setTimeout(() => { sfx('reveal'); setDone(true); }, 400);
    }, 300 + i * 450));
    return () => ts.forEach(clearTimeout);
  }, [cs, pops]);
  const cw = (Math.min(W, 520) - 52) / 2;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#1b1437', justifyContent: 'center', padding: 18 }}>
        <Grad colors={['#1b1437', '#2f2360', '#1b1437']} />
        <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 28, textAlign: 'center', marginBottom: 12 }}>{cs.length} hatched!</Text>
        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }} style={{ flexGrow: 0 }}>
          {cs.map((c, i) => {
            const ph = express(c.g);
            return (
              <Animated.View key={c.id} style={{ width: cw, opacity: pops[i], transform: [{ scale: pops[i].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>
                <Card tint={ELEMENTS[ph.el1].base} style={{ alignItems: 'center', marginBottom: 0, padding: 8 }}>
                  <View style={{ width: cw - 24, height: cw - 24, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Glow color={ELEMENTS[ph.el1].light} opacity={0.55} cy="60%" r="50%" />
                    <LiveCreature ph={ph} stage={stageOf(c)} size={cw - 24} />
                  </View>
                  <View style={st.row}>
                    <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }} numberOfLines={1}>{c.name}</Text>
                    {ph.shiny ? <Mark kind="shiny" size={14} /> : null}
                    <SexMark sex={c.sex} />
                  </View>
                  <Stars n={starRating(c.g)} size={13} />
                  <View style={{ marginTop: 4 }}><TypeChips ph={ph} /></View>
                </Card>
              </Animated.View>
            );
          })}
        </ScrollView>
        <Btn style={{ marginTop: 18, alignSelf: 'center', minWidth: 200 }} kind="gold" label={done ? 'Welcome!' : 'Hatching...'} disabled={!done} onPress={onClose} />
      </View>
    </Modal>
  );
}

/** Slow-turning rays of light behind a hatchling: the more stars, the brighter. */
function Rays({ size, color, strength }: { size: number; color: string; strength: number }) {
  const t = useLoop(22000);
  const R = size / 2, n = 12;
  const wedges = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2, w = (Math.PI * 2) / n * (i % 2 ? 0.26 : 0.4);
    return `M${R} ${R} L${(R + Math.cos(a0 - w / 2) * R).toFixed(1)} ${(R + Math.sin(a0 - w / 2) * R).toFixed(1)} L${(R + Math.cos(a0 + w / 2) * R).toFixed(1)} ${(R + Math.sin(a0 + w / 2) * R).toFixed(1)}Z`;
  }).join('');
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, opacity: strength, transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="hatchRays" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.55} /><Stop offset="0.55" stopColor={color} stopOpacity={0.2} /><Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Path d={wedges} fill="url(#hatchRays)" />
      </Svg>
    </Animated.View>
  );
}

const STAR_WORD = ['', 'Humble', 'Promising', 'Strong', 'Excellent', 'Extraordinary'];
const STAR_PATH = 'M12 1.8 L15.1 8.3 L22.2 9.2 L17 14.1 L18.4 21.2 L12 17.7 L5.6 21.2 L7 14.1 L1.8 9.2 L8.9 8.3Z';

/**
 * Hatching, on a lit stage in the hatchling's own colour: tap the egg until it breaks, the shell flies apart,
 * the stars land one by one, and then the creature hops out under turning rays of light.
 */
function HatchReveal({ c, onClose }: { c: Creature; onClose: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const ph = useMemo(() => express(c.g), [c.g]);
  const el = ELEMENTS[ph.el1];
  const stars = starRating(c.g);
  const [taps, setTaps] = useState(0);
  const [phase, setPhase] = useState<'egg' | 'burst' | 'stars' | 'creature'>('egg');
  const [shown, setShown] = useState(0);
  const wob = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const eggOut = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const plate = useRef(new Animated.Value(0)).current;
  const starPops = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;
  const eggSize = Math.min(W * 0.55, 240);
  const art = Math.min(W * 0.62, 270);
  const stageY = H * 0.4; // the middle of the stage, where the egg sits and the hatchling stands
  // Pieces of shell: where each flies, how it tumbles.
  const shards = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const a = -Math.PI / 2 + (i - 4) * 0.42 + ((i * 37) % 10) * 0.02;
    return { dx: Math.cos(a) * (90 + ((i * 53) % 60)), dy: Math.sin(a) * (70 + ((i * 31) % 50)), rot: (i % 2 ? 1 : -1) * (160 + i * 30), s: 10 + ((i * 7) % 9) };
  }), []);

  // Idle wobble that grows as the egg cracks, so it looks ready to burst.
  useEffect(() => {
    if (phase !== 'egg') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(wob, { toValue: 1, duration: 140, useNativeDriver: ND }),
      Animated.timing(wob, { toValue: -1, duration: 220, useNativeDriver: ND }),
      Animated.timing(wob, { toValue: 0, duration: 140, useNativeDriver: ND }),
      Animated.delay(Math.max(250, 1300 - taps * 400)),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase, taps, wob]);

  const onTap = () => {
    if (phase !== 'egg') return;
    const n = taps + 1;
    setTaps(n);
    haptic(n < TAPS ? 'select' : 'medium');
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: 0.5, duration: 50, useNativeDriver: ND }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: ND }),
    ]).start();
    if (n < TAPS) { sfx('crack'); return; }
    sfx('crackBig');
    setPhase('burst');
    setTimeout(() => sfx('hatch'), 150);
    Animated.parallel([
      Animated.sequence([Animated.timing(flash, { toValue: 1, duration: 140, useNativeDriver: ND }), Animated.timing(flash, { toValue: 0, duration: 460, useNativeDriver: ND })]),
      Animated.timing(eggOut, { toValue: 1, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
    ]).start(() => {
      setPhase('stars');
      // Stars land one at a time, each a little higher in pitch.
      for (let i = 0; i < stars; i++) setTimeout(() => {
        setShown(i + 1);
        sfx(('star' + (i + 1)) as SfxName);
        haptic('select');
        Animated.spring(starPops[i], { toValue: 1, friction: 4, tension: 120, useNativeDriver: ND }).start();
      }, 200 + i * 340);
      setTimeout(() => {
        setPhase('creature');
        sfx('reveal');
        haptic('medium');
        // Up out of the light with a hop, then the name plate follows.
        Animated.parallel([
          Animated.spring(pop, { toValue: 1, friction: 5, tension: 70, useNativeDriver: ND }),
          Animated.sequence([
            Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
            Animated.timing(rise, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
          ]),
          Animated.timing(plate, { toValue: 1, duration: 380, delay: 320, easing: Easing.out(Easing.cubic), useNativeDriver: ND }),
        ]).start();
      }, 200 + stars * 340 + 380);
    });
  };

  const out = phase !== 'egg' && phase !== 'burst';
  const rayColor = ph.shiny ? '#ffe9a8' : stars >= 5 ? '#ffd34d' : el.light;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onTap} style={{ flex: 1, backgroundColor: '#1b1437' }}>
        {/* The stage: a deep wash of the hatchling's own colour, brightest where it will stand. */}
        <Grad colors={[mixHex('#1b1437', el.dark, 0.3), mixHex('#2a1f55', el.base, 0.22), '#1b1437']} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: stageY - W * 0.75, height: W * 1.5, alignItems: 'center', justifyContent: 'center' }}>
          <Glow color={el.light} opacity={out ? 0.5 : 0.3 + taps * 0.07} r="50%" />
          {phase === 'creature' ? <Rays size={W * 1.5} color={rayColor} strength={0.35 + stars * 0.11} /> : null}
        </View>

        {!out ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: stageY - eggSize / 2, alignItems: 'center' }}>
            <Animated.View style={{
              opacity: eggOut.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 0, 0] }),
              transform: [
                { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) },
                { rotate: wob.interpolate({ inputRange: [-1, 1], outputRange: [`-${4 + taps * 3}deg`, `${4 + taps * 3}deg`] }) },
                { scale: eggOut.interpolate({ inputRange: [0, 0.25], outputRange: [1, 1.25], extrapolate: 'clamp' }) },
              ],
            }}>
              <EggView ph={ph} size={eggSize} />
              <Svg width={eggSize} height={eggSize} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
                {taps > 0 ? <Path d={CRACKS[Math.min(taps, 3)]} stroke="#2a1d33" strokeWidth={1.6} fill="none" strokeLinejoin="round" /> : null}
                {taps >= 2 ? <Path d={CRACKS[Math.min(taps, 3)]} stroke="#fff6c8" strokeWidth={0.6} fill="none" opacity={0.9} /> : null}
              </Svg>
            </Animated.View>
            {/* The shell flies apart. */}
            {phase === 'burst' ? shards.map((sh, i) => (
              <Animated.View key={i} pointerEvents="none" style={{
                position: 'absolute', top: eggSize / 2 - sh.s / 2, left: W / 2 - sh.s / 2,
                opacity: eggOut.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateX: eggOut.interpolate({ inputRange: [0, 1], outputRange: [0, sh.dx] }) },
                  { translateY: eggOut.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, sh.dy, sh.dy * 0.7 + 90] }) },
                  { rotate: eggOut.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${sh.rot}deg`] }) },
                ],
              }}>
                <Svg width={sh.s} height={sh.s} viewBox="0 0 10 10"><Path d="M1 3 L5 0.5 L9 4 L7.5 9 L3 8.5Z" fill={i % 3 ? mixHex(el.light, '#ffffff', 0.55) : el.light} stroke={mixHex(el.dark, '#2a1d33', 0.5)} strokeWidth={0.8} strokeLinejoin="round" /></Svg>
              </Animated.View>
            )) : null}
            <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 19, marginTop: 18, opacity: phase === 'egg' ? 1 : 0 }}>{taps === 0 ? 'Tap the egg to open it' : 'Keep tapping!'}</Text>
            <View style={{ flexDirection: 'row', gap: 7, marginTop: 9, opacity: phase === 'egg' ? 1 : 0 }}>
              {Array.from({ length: TAPS }, (_, i) => <View key={i} style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: i < taps ? C.gold : 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.3)' }} />)}
            </View>
          </View>
        ) : (
          <View style={{ position: 'absolute', left: 0, right: 0, top: stageY - art * 0.5 - 62, alignItems: 'center' }}>
            {/* Its stars, landing one by one. */}
            <View style={{ flexDirection: 'row', gap: 5, height: 40, alignItems: 'center' }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Animated.View key={i} style={{ opacity: i < stars ? starPops[i] : 1, transform: [{ scale: i < stars ? starPops[i].interpolate({ inputRange: [0, 1], outputRange: [2.6, 1] }) : 1 }] }}>
                  <Svg width={34} height={34} viewBox="0 0 24 24">
                    {i < stars ? (
                      <>
                        <Path d={STAR_PATH} fill="#f7b52e" stroke="#a8670f" strokeWidth={1.5} strokeLinejoin="round" />
                        <Path d="M12 5.5 L13.9 9.8 L18 10.3 L12 12.5 L6 10.3 L10.1 9.8Z" fill="#ffe58a" />
                      </>
                    ) : <Path d={STAR_PATH} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2} strokeLinejoin="round" />}
                  </Svg>
                </Animated.View>
              ))}
            </View>
            <Text style={{ color: stars >= 4 ? C.gold : '#d9ccff', fontFamily: F.semi, fontSize: 15, height: 22, marginTop: 2, opacity: shown >= stars ? 1 : 0 }}>{STAR_WORD[stars]}</Text>
            <View style={{ width: art, height: art, alignItems: 'center', justifyContent: 'flex-end' }}>
              {phase === 'creature' ? (
                <Animated.View style={{ opacity: pop.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -art * 0.16] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }] }}>
                  <LiveCreature ph={ph} stage={stageOf(c)} size={art} />
                </Animated.View>
              ) : null}
            </View>
            <Animated.View style={{ alignItems: 'center', opacity: plate, transform: [{ translateY: plate.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
              <View style={[st.row, { gap: 6 }]}>
                <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 28, textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 }}>{c.name}</Text>
                <SexMark sex={c.sex} size={16} />
              </View>
              {ph.shiny ? (
                <View style={[st.row, { gap: 6, marginTop: 2 }]}>
                  <Mark kind="shiny" size={15} /><Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 18 }}>A shiny!</Text><Mark kind="shiny" size={15} />
                </View>
              ) : null}
              <View style={{ marginVertical: 7 }}><TypeChips ph={ph} /></View>
              <P dim>{SKELETON_NAMES[ph.skel]} · {c.origin === 'bred' ? 'Bred' : 'Wild-born'}</P>
              {c.mom && c.dad ? <P dim>Child of {c.mom.name} and {c.dad.name}</P> : null}
              <Btn style={{ marginTop: 16, minWidth: 190 }} kind="gold" label="Welcome!" onPress={onClose} />
            </Animated.View>
          </View>
        )}
        {/* The flash as the shell breaks. */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: W / 2 - W * 0.7, top: stageY - W * 0.7, width: W * 1.4, height: W * 1.4, opacity: flash, transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
          <Glow color="#fff8dc" opacity={0.95} r="50%" />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** An egg that rocks gently now and then, as if something inside is stirring. */
function Rocking({ children, strength = 1 }: { children: React.ReactNode; strength?: number }) {
  const t = useLoop(useMemo(() => 2600 + Math.random() * 1800, []));
  const rot = t.interpolate({ inputRange: [0, 0.62, 0.7, 0.78, 0.86, 0.94, 1], outputRange: ['0deg', '0deg', `${6 * strength}deg`, `${-5 * strength}deg`, `${3 * strength}deg`, '0deg', '0deg'] });
  return <Animated.View style={{ transform: [{ translateY: 20 }, { rotate: rot }, { translateY: -20 }] }}>{children}</Animated.View>;
}

function EggCard({ egg, onPress, selected }: { egg: Egg; onPress?: () => void; selected?: boolean }) {
  const ph = useMemo(() => express(egg.g), [egg.g]);
  return (
    <Card onPress={onPress} glow={selected ? C.gold : undefined} style={{ width: 98, alignItems: 'center', marginBottom: 0, padding: 7 }}>
      <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center' }}>
        <Glow color={selected ? '#ffd34d' : '#c2b0ff'} opacity={selected ? 0.5 : 0.25} />
        <Rocking strength={0.7}><EggView ph={ph} size={62} /></Rocking>
      </View>
      <Stars n={starRating(egg.g)} size={11} />
      <Text style={{ color: C.dim, fontSize: 10.5, fontFamily: F.med }}>{egg.origin === 'bred' ? 'Bred' : 'Wild'}{egg.mutations ? ' · mutated' : ''}</Text>
    </Card>
  );
}

/** An incubator: the egg sits in a glowing cradle ringed by its progress. */
function IncubatorArt({ ph, frac, ready, wobble }: { ph?: ReturnType<typeof express>; frac: number; ready: boolean; wobble: number }) {
  const S = 92, R = 40, circ = 2 * Math.PI * R;
  const t = useLoop(1600, ready);
  return (
    <View style={{ width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
      {ready ? <Animated.View style={[{ position: 'absolute', width: S, height: S, opacity: pulse(t, 0.5, 1), transform: [{ scale: pulse(t, 0.95, 1.08) }] }]}><Glow color="#ffd34d" opacity={0.7} /></Animated.View> : <Glow color="#8f7cff" opacity={ph ? 0.35 : 0.15} />}
      <Svg width={S} height={S} style={{ position: 'absolute' }}>
        <Circle cx={S / 2} cy={S / 2} r={R} stroke="rgba(255,255,255,0.1)" strokeWidth={6} fill="rgba(10,6,22,0.35)" strokeDasharray={ph ? undefined : '4 6'} />
        {ph ? <Circle cx={S / 2} cy={S / 2} r={R} stroke={ready ? '#ffd34d' : '#a898ff'} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - Math.max(0.02, Math.min(1, frac)))} transform={`rotate(-90 ${S / 2} ${S / 2})`} /> : null}
      </Svg>
      {ph ? <View style={{ transform: [{ rotate: `${wobble * 8}deg` }] }}><Rocking strength={ready ? 0 : 0.6}><EggView ph={ph} size={60} /></Rocking></View> : <Icon name="egg" size={34} color="rgba(255,255,255,0.18)" accent="rgba(0,0,0,0)" />}
    </View>
  );
}

/** A friendly empty state: a big icon in a soft glow and a line of help. */
function Empty({ icon, color, title, text }: { icon: IconName; color: string; title: string; text: string }) {
  return (
    <FadeIn>
      <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
        <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
          <Glow color={color} opacity={0.55} />
          <View><Icon name={icon} size={46} color={color} accent="#2b2054" /></View>
        </View>
        <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 18, marginBottom: 2 }}>{title}</Text>
        <P dim style={{ textAlign: 'center' }}>{text}</P>
      </Card>
    </FadeIn>
  );
}

export function NurseryScreen() {
  const { save, mutate } = useGame();
  const now = useNow(1000);
  const [selEgg, setSelEgg] = useState<string | null>(null);
  const [born, setBorn] = useState<Creature | null>(null);
  const [bornMany, setBornMany] = useState<Creature[] | null>(null);
  const full = save.creatures.length >= save.rosterCap;
  const nextSlot = INC_SLOT_COST[save.incubators.length];
  const egg = save.eggs.find(e => e.id === selEgg) ?? save.eggs[0];
  const [tossing, setTossing] = useState<string | null>(null);
  const [tossed, setTossed] = useState<{ n: number; essence: number } | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <Title icon="egg" color="#ffb35c">Incubators</Title>
        {(() => {
          // Shortcuts once there are a few incubators: hatch everything that's ready, and refill the empty ones.
          const readyN = save.incubators.filter(inc => inc.egg && inc.readyAt <= now).length;
          const emptyN = save.incubators.filter(inc => !inc.egg).length;
          const room = save.rosterCap - save.creatures.length;
          if (save.tutorial < TUT.DONE || (readyN < 2 && !(emptyN >= 2 && save.eggs.length >= 2))) return null;
          return (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {readyN >= 2 ? (
                <Btn style={{ flex: 1 }} kind="gold" disabled={room <= 0} label={room <= 0 ? 'Roster is full' : `Hatch all (${Math.min(readyN, room)})`}
                  icon={<Icon name="egg" size={17} color="#3d2400" accent="#ffe58a" />}
                  onPress={() => { const cs = mutate(s => hatchAll(rng, s, Date.now())); if (cs.length === 1) setBorn(cs[0]); else if (cs.length) setBornMany(cs); }} />
              ) : null}
              {emptyN >= 1 && save.eggs.length >= 1 && (emptyN >= 2 || readyN >= 2) ? (
                <Btn style={{ flex: 1 }} kind="main" label={`Fill ${Math.min(emptyN, save.eggs.length)} empty`}
                  onPress={() => { if (mutate(s => fillIncubators(s, Date.now()))) { sfx('egg'); haptic('select'); } }} />
              ) : null}
            </View>
          );
        })()}
        {save.incubators.length === 0 ? <Empty icon="egg" color="#ffb35c" title="No incubator yet" text="You'll get your first incubator after your first fight." /> : null}
        {save.incubators.map((inc, i) => {
          const up = INC_UPGRADE[inc.tier + 1];
          const left = inc.egg ? inc.readyAt - now : 0;
          const total = inc.egg ? Math.max(1, inc.readyAt - inc.startedAt) : 1;
          const ready = !!inc.egg && left <= 0;
          const cost = inc.egg ? speedUpCost(save, inc, now) : 0;
          return (
            <FadeIn key={i} delay={i * 70}>
            <Card glow={ready ? C.gold : undefined} tint={ready ? '#f5c542' : undefined}>
              <View style={st.row}>
                <IncubatorArt ph={inc.egg ? express(inc.egg.g) : undefined} frac={inc.egg ? 1 - left / total : 0} ready={ready} wobble={ready ? Math.sin(now / 200) : 0} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 17 }}>Incubator {i + 1} <Text style={{ color: C.dim, fontFamily: F.med, fontSize: 13 }}>· Tier {inc.tier}</Text></Text>
                  {inc.egg ? (
                    <>
                      <Stars n={starRating(inc.egg.g)} />
                      {ready ? <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 16, marginTop: 2 }}>Ready to hatch!</Text> : (
                        <>
                          <View style={{ marginTop: 4 }}><Bar frac={1 - left / total} color="#a898ff" height={8} /></View>
                          <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 13, marginTop: 3 }}>{fmtTime(left)} left</Text>
                        </>
                      )}
                    </>
                  ) : <P dim>{inc.tier > 1 ? 'Better tiers hatch faster and raise hidden potential.' : 'Empty. Pick an egg below.'}</P>}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {ready ? <Btn style={{ flex: 1 }} kind="gold" label={full ? 'Roster is full' : 'Hatch'} disabled={full} onPress={() => { const c = mutate(s => hatchEgg(rng, s, i, Date.now())); if (c) setBorn(c); }} /> : null}
                {inc.egg && !ready ? <Btn style={{ flex: 1 }} small kind="ghost" label={`Speed up (${cost} gold)`} disabled={save.gold < cost} onPress={() => mutate(s => { speedUp(s, i, Date.now()); })} /> : null}
                {!inc.egg && egg ? <Btn style={{ width: '100%' }} label="Place selected egg" onPress={() => mutate(s => { placeEgg(s, i, egg.id, Date.now()); })} /> : null}
                {!inc.egg && up ? <Btn small kind="ghost" label={`Upgrade: ${up.gold}g${up.dust ? ` ${up.dust} dust` : ''}${up.shard ? ` ${up.shard} shards` : ''}${up.core ? ` ${up.core} cores` : ''}`} disabled={save.gold < up.gold || save.dust < up.dust || save.shard < up.shard || save.core < up.core} onPress={() => mutate(s => { upgradeIncubator(s, i); })} /> : null}
              </View>
              {inc.egg && !ready && cost > 0 ? <P dim style={{ marginTop: 4 }}>Each speed-up in a day costs more than the last.</P> : null}
            </Card>
            </FadeIn>
          );
        })}
        {save.incubators.length > 0 && nextSlot != null ? <Btn kind="ghost" label={`Buy another incubator (${nextSlot} gold)`} disabled={save.gold < nextSlot} onPress={() => mutate(s => { buyIncubator(s); })} /> : null}

        <View style={{ height: 16 }} />
        <Title icon="sparkle" color="#c2b0ff" right={<Text style={{ color: C.dim, fontFamily: F.semi }}>{save.eggs.length}/20</Text>}>Eggs</Title>
        {save.eggs.length === 0 ? <Empty icon="egg" color="#c2b0ff" title="No eggs yet" text="Enemies sometimes drop them, boss chests often do, and you can breed two adults." /> : (
          <>
            <P dim style={{ marginBottom: 8 }}>Stars show how good the hatchling's genes are. The colour hints at its element.</P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {save.eggs.map(e => <EggCard key={e.id} egg={e} selected={egg?.id === e.id} onPress={() => setSelEgg(e.id)} />)}
            </View>
            {egg ? <P dim style={{ marginTop: 8 }}>Selected egg takes {fmtTime(incubationMs(egg, 1))} in a tier 1 incubator{save.tutorial < TUT.DONE ? ' (instant during the tutorial)' : ''}.</P> : null}
            {egg && save.tutorial >= TUT.DONE ? (
              tossing === egg.id ? (
                <FadeIn dy={8}>
                  <Card tint={C.bad} style={{ marginTop: 8, marginBottom: 0 }}>
                    <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }}>Discard this egg?</Text>
                    <P dim style={{ marginBottom: 10 }}>You get {eggValue(egg)} essence. This can't be undone.</P>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Btn style={{ flex: 1 }} kind="ghost" label="Keep" onPress={() => setTossing(null)} />
                      <Btn style={{ flex: 1 }} kind="danger" label="Discard" onPress={() => {
                        const v = mutate(s => discardEgg(s, egg.id));
                        setTossing(null);
                        setSelEgg(null);
                        if (v) { sfx('crack'); haptic('medium'); setTossed(t => ({ n: (t?.n ?? 0) + 1, essence: v })); }
                      }} />
                    </View>
                  </Card>
                </FadeIn>
              ) : (
                <Btn small kind="ghost" style={{ marginTop: 8, alignSelf: 'flex-start' }} label={`Discard selected egg (+${eggValue(egg)} essence)`} onPress={() => { setTossing(egg.id); haptic('select'); }} />
              )
            ) : null}
            {tossed ? <FadeIn key={tossed.n}><P style={{ color: C.gold, marginTop: 6 }}>Egg discarded. +{tossed.essence} essence.</P></FadeIn> : null}
          </>
        )}
      </ScrollView>
      {born ? <HatchReveal c={born} onClose={() => setBorn(null)} /> : null}
      {bornMany ? <HatchAllReveal cs={bornMany} onClose={() => setBornMany(null)} /> : null}
    </View>
  );
}

const pct = (p: number) => (p > 0 && p < 0.01 ? '<1%' : Math.round(p * 100) + '%');

export function BreedScreen() {
  const { save, mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const now = useNow(1000);
  const [momId, setMom] = useState<string | null>(null);
  const [dadId, setDad] = useState<string | null>(null);
  const [mats, setMats] = useState<BreedMats>({ dust: false, shard: false, core: false });
  const [made, setMade] = useState<Egg | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [picking, setPicking] = useState<'F' | 'M' | null>(null);
  const mom = save.creatures.find(c => c.id === momId);
  const dad = save.creatures.find(c => c.id === dadId);
  const problem = breedProblem(save, mom, dad, now, mats);
  const fc = useMemo(() => (mom && dad ? forecast(rng, mom.g, dad.g, 500) : null), [mom?.id, dad?.id]);
  const tw = (W - 28 - 16) / 3;
  const adults = useMemo(() => [...save.creatures].sort((a, b) => stageOf(b) - stageOf(a) || b.level - a.level), [save.creatures]);
  const choose = (c: Creature) => (c.sex === 'F' ? setMom(c.id) : setDad(c.id));
  const tutorial = save.tutorial < TUT.DONE;
  const Slot = ({ c, label, sex }: { c?: Creature; label: string; sex: 'F' | 'M' }) => (
    <Pressable onPress={() => { haptic('select'); setPicking(sex); }} style={[{ flex: 1, borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: c ? 'rgba(255,255,255,0.1)' : (sex === 'F' ? C.female : C.male) + 'aa' }, shadow(sex === 'F' ? C.female : C.male, 10, c ? 0.2 : 0.45, 0)]}>
      <Grad colors={[mixHex('#4f4189', sex === 'F' ? C.female : C.male, 0.25), '#382c66']} />
      <View style={{ alignItems: 'center', padding: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(10,6,22,0.45)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 }}>
        <Text style={{ color: sex === 'F' ? C.female : C.male, fontSize: 12, fontFamily: F.semi }}>{label}</Text>
        <SexMark sex={sex} size={11} />
      </View>
      {c ? (
        <>
          <View style={{ width: 96, height: 92, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Glow color={sex === 'F' ? C.female : C.male} opacity={0.35} cy="65%" />
            <Breathing size={92}><CreatureView ph={express(c.g)} stage={stageOf(c)} size={92} /></Breathing>
          </View>
          <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }}>{c.name}</Text>
          <Stars n={starRating(c.g)} size={11} />
          <Text style={{ color: C.dim, fontSize: 10 }}>Bred {c.bred} time{c.bred === 1 ? '' : 's'}</Text>
          <Btn small kind="ghost" label="Pedigree" onPress={() => setDetail(c.id)} />
        </>
      ) : (
        <View style={{ alignItems: 'center', marginVertical: 18 }}>
          <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderStyle: 'dashed', borderColor: (sex === 'F' ? C.female : C.male) + 'aa', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Text style={{ color: sex === 'F' ? C.female : C.male, fontSize: 32, fontFamily: F.bold, marginTop: -3 }}>+</Text>
          </View>
          <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 14 }}>Tap to choose</Text>
        </View>
      )}
      </View>
    </Pressable>
  );
  const beat = useLoop(1100);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <Title icon="heart" color="#ff7fae">Breeding</Title>
        <P dim style={{ marginBottom: 8 }}>Each parent passes one of its two genes for every trait. The egg can look like either parent, a mix, or show something both were hiding.</P>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Slot c={mom} label="Mother" sex="F" />
          <Animated.View style={{ position: 'absolute', left: '50%', marginLeft: -17, zIndex: 2, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2050', borderWidth: 2, borderColor: '#ff7fae', transform: [{ scale: beat.interpolate({ inputRange: [0, 0.12, 0.24, 0.36, 1], outputRange: [1, 1.2, 1, 1.12, 1] }) }] }}>
            <View><Icon name="heart" size={18} color="#ff7fae" /></View>
          </Animated.View>
          <Slot c={dad} label="Father" sex="M" />
        </View>

        {fc ? (
          <Card style={{ marginTop: 10 }}>
            <H>Forecast</H>
            <P dim>Odds only. It doesn't say which hidden genes are behind them.</P>
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Type</Text>
            {fc.types.slice(0, 5).map(t => (
              <View key={t.label} style={[st.row, { marginVertical: 1 }]}>
                <Text style={{ color: C.text, fontSize: 12, width: 130 }} numberOfLines={1}>{t.label}</Text>
                <View style={{ flex: 1 }}><Bar frac={t.p} color={C.accent} /></View>
                <Text style={{ color: C.dim, fontSize: 11, width: 34, textAlign: 'right' }}>{pct(t.p)}</Text>
              </View>
            ))}
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Body</Text>
            {fc.skels.slice(0, 4).map(s => (
              <View key={s.skel} style={[st.row, { marginVertical: 1 }]}>
                <Text style={{ color: C.text, fontSize: 12, width: 130 }} numberOfLines={1}>{SKELETON_NAMES[s.skel]}</Text>
                <View style={{ flex: 1 }}><Bar frac={s.p} color="#6fc3ff" /></View>
                <Text style={{ color: C.dim, fontSize: 11, width: 34, textAlign: 'right' }}>{pct(s.p)}</Text>
              </View>
            ))}
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Stars</Text>
            {fc.stars.map((p, i) => (p > 0 ? (
              <View key={i} style={[st.row, { marginVertical: 1 }]}>
                <View style={{ width: 130 }}><Stars n={i + 1} size={12} /></View>
                <View style={{ flex: 1 }}><Bar frac={p} color="#f7b52e" /></View>
                <Text style={{ color: C.dim, fontSize: 11, width: 34, textAlign: 'right' }}>{pct(p)}</Text>
              </View>
            ) : null))}
            <P dim style={{ marginTop: 6 }}>Legendary move slot: {pct(fc.legendary)} · Dual type: {pct(fc.dual)}</P>
          </Card>
        ) : null}

        <Card style={{ marginTop: 10 }}>
          <H>Extras (optional)</H>
          <P dim>Materials improve odds and quality, never raw power.</P>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Btn small kind={mats.dust ? 'main' : 'ghost'} label={`${MAT_COST.dust} dust: better potential`} onPress={() => setMats(m => ({ ...m, dust: !m.dust }))} />
            <Btn small kind={mats.shard ? 'main' : 'ghost'} label={`${MAT_COST.shard} shards: more mutation`} onPress={() => setMats(m => ({ ...m, shard: !m.shard }))} />
            <Btn small kind={mats.core ? 'main' : 'ghost'} label={`${MAT_COST.core} core: rarer genes`} onPress={() => setMats(m => ({ ...m, core: !m.core }))} />
          </View>
          <P dim style={{ marginTop: 4 }}>You have {save.dust} dust, {save.shard} shards, {save.core} cores.</P>
        </Card>

        <Btn
          kind="gold"
          label={mom && dad ? (tutorial ? 'Breed (free this time)' : `Breed for ${breedCost(mom, dad)} gold`) : 'Pick two parents'}
          disabled={!!problem}
          onPress={() => { const e = mutate(s => doBreed(rng, s, momId!, dadId!, mats, Date.now())); if (e) { sfx('breed'); setTimeout(() => sfx('egg'), 700); setMade(e); setMats({ dust: false, shard: false, core: false }); } }}
        />
        {problem && (mom || dad) ? <P style={{ color: C.bad, marginTop: 4, textAlign: 'center' }}>{problem}</P> : null}
        <P dim style={{ marginTop: 4, textAlign: 'center' }}>Cost rises with the parents' rarity and how often they've bred. Parents rest afterwards.</P>

      </ScrollView>
      {made ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMade(null)}>
          <View style={{ flex: 1, backgroundColor: '#000c', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>A new egg!</Text>
            <EggView ph={express(made.g)} size={W * 0.5} />
            <Stars n={starRating(made.g)} size={30} />
            {made.mutations ? <P style={{ color: C.accent2, marginTop: 4 }}>Something mutated. It may show a trait neither parent had.</P> : null}
            <P dim style={{ marginTop: 6, textAlign: 'center' }}>Put it in an incubator in the Nursery to find out what it is.</P>
            <Btn style={{ marginTop: 14, minWidth: 180 }} kind="gold" label="OK" onPress={() => setMade(null)} />
          </View>
        </Modal>
      ) : null}
      {picking ? (
        <Modal visible animationType="slide" onRequestClose={() => setPicking(null)}>
          <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 50 }}>
            <View style={{ paddingHorizontal: 14 }}>
              <H>Choose the {picking === 'F' ? 'mother' : 'father'}</H>
              <P dim>Only adults can breed, and parents rest after each egg.</P>
            </View>
            <ScrollView contentContainerStyle={{ padding: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {adults.filter(c => c.sex === picking).map(c => {
                const adult = stageOf(c) >= 2;
                const resting = c.breedReadyAt > now;
                return <CreatureTile key={c.id} c={c} width={tw} selected={c.id === momId || c.id === dadId} dimmed={!adult || resting} badge={!adult ? `Adult at ${stageLevels(express(c.g))[2]}` : resting ? fmtTime(c.breedReadyAt - now) : undefined} onPress={() => { choose(c); setPicking(null); }} />;
              })}
              {adults.filter(c => c.sex === picking).length === 0 ? <P dim>You have no {picking === 'F' ? 'females' : 'males'} yet.</P> : null}
            </ScrollView>
            <View style={{ padding: 14, paddingBottom: 30 }}><Btn kind="ghost" label="Back" onPress={() => setPicking(null)} /></View>
          </View>
        </Modal>
      ) : null}
      {detail ? <CreatureDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

export { STAGE_NAMES, typeLabel };
