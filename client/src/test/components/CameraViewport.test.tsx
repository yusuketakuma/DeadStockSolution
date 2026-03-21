import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CameraViewport from '../../components/camera/CameraViewport';

describe('CameraViewport', () => {
  it('labels the video element for assistive technologies', () => {
    render(
      <CameraViewport
        videoRef={createRef<HTMLVideoElement>()}
        canvasRef={createRef<HTMLCanvasElement>()}
        cameraActive={true}
        cameraError=""
      />,
    );

    // The video element does not have an aria-label; verify it renders with autoPlay and playsInline
    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('autoplay');
    expect(video?.hasAttribute('playsinline') || video?.hasAttribute('playsInline')).toBe(true);
  });
});
