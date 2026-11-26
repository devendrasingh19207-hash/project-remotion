import React from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {getSceneFrameRanges} from './timeline.js';

type TextElement = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
};

type Scene = {
  id: string;
  duration: number;
  background: string;
  transition?: string;
  visualHint?: string;
  elements: TextElement[];
};

export type NotesVideoProps = {
  scenes: Scene[];
  audioSrc: string;
  fps: number;
};

const SceneContent: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const opacity = scene.transition === 'none' ? 1 : interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateX = scene.transition === 'slide_left'
    ? interpolate(frame, [0, 12], [80, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 0;
  const translateY = scene.transition === 'slide_up'
    ? interpolate(frame, [0, 12], [80, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 0;
  const scale = scene.transition === 'zoom'
    ? interpolate(frame, [0, 12], [0.94, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: scene.background,
        opacity,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at 18% 12%, rgba(86, 116, 255, 0.18), transparent 48%), radial-gradient(ellipse at 90% 86%, rgba(36, 210, 192, 0.12), transparent 42%)',
        }}
      />
      {scene.elements.map((element, index) => {
        const transform = element.align === 'center'
          ? 'translateX(-50%)'
          : element.align === 'right'
            ? 'translateX(-100%)'
            : undefined;
        return (
          <div
            key={`${scene.id}-${index}`}
            style={{
              position: 'absolute',
              left: element.x,
              top: element.y,
              transform,
              maxWidth: 1680,
              color: element.color,
              fontFamily: 'Arial, sans-serif',
              fontSize: element.fontSize,
              fontWeight: element.bold ? 700 : 400,
              lineHeight: 1.25,
              textAlign: element.align ?? 'center',
              textShadow: '0 4px 24px rgba(0, 0, 0, 0.32)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {element.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const NotesVideo: React.FC<NotesVideoProps> = ({scenes, audioSrc}) => {
  const {durationInFrames} = useVideoConfig();
  const ranges = getSceneFrameRanges(scenes, durationInFrames);

  return (
    <AbsoluteFill style={{backgroundColor: '#0f1115'}}>
      {scenes.map((scene, index) => (
        <Sequence
          key={scene.id}
          from={ranges[index].from}
          durationInFrames={ranges[index].durationInFrames}
          name={scene.id}
        >
          <SceneContent scene={scene} />
        </Sequence>
      ))}
      <Audio src={audioSrc} />
    </AbsoluteFill>
  );
};
