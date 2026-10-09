#!/usr/bin/env python3
"""Poll CAFP for farm actions and hand them to locally configured hardware adapters.

Adapters are separate executables supplied for the site's actual relay/drone hardware.
An explicit enable flag is required before polling; absent adapters fail safely.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ACTIONS={'irrigation':'IRRIGATION_ADAPTER','open_drone_house':'DRONE_HOUSE_ADAPTER',
         'launch_drone':'DRONE_LAUNCH_ADAPTER'}


def call(base,key,path,body):
    request=urllib.request.Request(base.rstrip('/')+path,json.dumps(body).encode(),method='POST',
        headers={'Content-Type':'application/json','x-device-key':key})
    with urllib.request.urlopen(request,timeout=20) as response:
        return json.load(response)


def execute(command,enabled):
    action=command['action']; adapter=os.environ.get(ACTIONS[action],'')
    if not enabled or not os.path.isabs(adapter) or not os.access(adapter,os.X_OK):
        return 'failed','Actuator disabled or executable adapter missing'
    if action=='launch_drone' and os.environ.get('DRONE_ARMED')!='true':
        return 'failed','Drone adapter is not armed on this gateway'
    duration=int(command['duration_seconds'])
    try:
        result=subprocess.run([adapter,command['id'],str(duration)],capture_output=True,text=True,
                              timeout=max(30,duration+30),check=False)
        return ('succeeded' if result.returncode==0 else 'failed'),(result.stdout if result.returncode==0 else result.stderr)[-500:]
    except (OSError,subprocess.TimeoutExpired) as error:
        return 'failed',str(error)[-500:]


def main():
    parser=argparse.ArgumentParser(description='CAFP gateway command worker')
    parser.add_argument('--enable-actuators',action='store_true',help='Run locally configured hardware adapters')
    parser.add_argument('--interval',type=int,default=5)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    if not args.enable_actuators:parser.error('Pass --enable-actuators only after configuring and testing local adapters')
    base=os.environ.get('CAFP_URL','');key=os.environ.get('CAFP_DEVICE_KEY','')
    if not base.startswith('https://') or not key or args.interval<1:parser.error('Set HTTPS CAFP_URL, CAFP_DEVICE_KEY, and interval >=1')
    while True:
        try:
            item=call(base,key,'/api/automation/gateway/poll',{}).get('command')
            if item:
                status,note=execute(item,args.enable_actuators)
                call(base,key,'/api/automation/gateway/'+item['id']+'/ack',{'status':status,'note':note})
                print(item['id'],item['action'],status,flush=True)
        except (urllib.error.URLError,ValueError,KeyError) as error:
            print('gateway error:',error,file=sys.stderr,flush=True)
            if args.once:return 1
        if args.once:return 0
        time.sleep(args.interval)


if __name__=='__main__':sys.exit(main())
