import React from 'react';
import {ALL_FORMATS, Input, UrlSource} from 'mediabunny';
import {CalculateMetadataFunction, Composition} from 'remotion';
import {NotesVideo, NotesVideoProps} from './Video';

const calculateMetadata: CalculateMetadataFunction<NotesVideoProps> = async ({props}) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(props.audioSrc),
  });
  let durationSeconds: number;
  try {
    durationSeconds = await input.computeDuration();
  } finally {
    input.dispose();
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Could not determine narration duration.');
  }
  return {
    fps: props.fps,
    durationInFrames: Math.ceil(durationSeconds * props.fps),
  };
};

export const Root: React.FC = () => (
  <Composition
    id="NotesToVideo"
    component={NotesVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
    defaultProps={{scenes: [], audioSrc: '', fps: 30}}
    calculateMetadata={calculateMetadata}
  />
);
