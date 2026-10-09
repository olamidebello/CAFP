#!/usr/bin/env python3
"""Capture bounded snapshots/clips from an already enabled local RTSP stream.

Runs on a gateway that can reach both the camera LAN and the CAFP HTTPS API.
No Wyze cloud login, unofficial API, or camera firmware flashing is performed.
"""
import argparse
import datetime as dt
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request


def capture(rtsp, seconds=None):
    mime = 'video/mp4' if seconds else 'image/jpeg'
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp',
               '-i', rtsp, '-an']
    if seconds:
        command += ['-t', str(seconds), '-vf', 'scale=640:-2', '-c:v', 'libx264',
                    '-preset', 'ultrafast', '-crf', '32', '-movflags', 'frag_keyframe+empty_moov',
                    '-f', 'mp4', 'pipe:1']
    else:
        command += ['-frames:v', '1', '-vf', 'scale=1024:-2', '-q:v', '5', '-f', 'image2', 'pipe:1']
    result = subprocess.run(command, capture_output=True, timeout=(seconds or 0)+30, check=False)
    if result.returncode or not result.stdout:
        raise RuntimeError('ffmpeg capture failed: '+result.stderr.decode('utf-8', 'replace')[-350:])
    if len(result.stdout)>8_000_000:
        raise RuntimeError('Capture exceeds the 8 MB upload limit; reduce resolution or clip length')
    return result.stdout, mime


def upload(endpoint, key, payload, mime):
    request=urllib.request.Request(endpoint.rstrip('/')+'/api/media/device',payload,method='POST',headers={
        'Content-Type':mime, 'x-device-key':key,
        'x-captured-at':dt.datetime.now(dt.timezone.utc).isoformat(),
        'x-media-note':'Wyze Cam v3 RTSP gateway capture'})
    with urllib.request.urlopen(request,timeout=40) as response:
        return response.status


def motion_score(previous, current):
    """Mean luminance difference after downsampling; this is motion, not object detection."""
    from PIL import Image, ImageChops, ImageStat
    with Image.open(io.BytesIO(previous)) as old, Image.open(io.BytesIO(current)) as new:
        a=old.convert('L').resize((64,64))
        b=new.convert('L').resize((64,64))
        return ImageStat.Stat(ImageChops.difference(a,b)).mean[0]/255


def report_motion(endpoint,key,score):
    payload=json.dumps({'signal':'camera_motion','detail':f'Image difference {score:.3f}'}).encode()
    request=urllib.request.Request(endpoint.rstrip('/')+'/api/automation/device-event',payload,
        method='POST',headers={'Content-Type':'application/json','x-device-key':key})
    with urllib.request.urlopen(request,timeout=40) as response:
        return response.status


def main():
    parser=argparse.ArgumentParser(description='Feed Wyze RTSP snapshots and optional short clips to CAFP')
    parser.add_argument('--once',action='store_true',help='Capture one snapshot and exit')
    parser.add_argument('--interval',type=int,default=300,help='Seconds between snapshots (minimum 30)')
    parser.add_argument('--clip-seconds',type=int,default=0,help='Optional MP4 clip length (1–15 seconds)')
    parser.add_argument('--motion-threshold',type=float,default=0,
                        help='Report camera motion when image difference exceeds 0–1 threshold; needs Pillow')
    args=parser.parse_args()
    if args.interval<30 or args.clip_seconds<0 or args.clip_seconds>15 or not 0<=args.motion_threshold<=1:
        parser.error('Use interval >=30, clip seconds 0–15, motion threshold 0–1')
    rtsp=os.environ.get('WYZE_RTSP_URL','')
    endpoint=os.environ.get('CAFP_URL','')
    key=os.environ.get('CAFP_DEVICE_KEY','')
    if not rtsp.startswith('rtsp://') or not endpoint.startswith('https://') or not key:
        parser.error('Set WYZE_RTSP_URL, HTTPS CAFP_URL, and CAFP_DEVICE_KEY')
    previous=None
    while True:
        try:
            photo,mime=capture(rtsp)
            print('snapshot',upload(endpoint,key,photo,mime),flush=True)
            if args.motion_threshold and previous is not None:
                score=motion_score(previous,photo)
                if score>=args.motion_threshold:
                    print('motion',score,report_motion(endpoint,key,score),flush=True)
            previous=photo
            if args.clip_seconds:
                clip,mime=capture(rtsp,args.clip_seconds)
                print('clip',upload(endpoint,key,clip,mime),flush=True)
        except (RuntimeError, subprocess.TimeoutExpired, urllib.error.URLError) as error:
            print('feeder error:',error,file=sys.stderr,flush=True)
            if args.once:return 1
        if args.once:return 0
        time.sleep(args.interval)


if __name__=='__main__':sys.exit(main())
