from pathlib import Path
import time
import pexpect
import shutil
import os


def create_bitcoind_config(lndconfig, debug=False):

    dir_name = "/data/bitcoind"
    Path(dir_name).mkdir(parents=True, exist_ok=True)

    print(dir_name + " - Main folder ")
    file_name = dir_name + "/bitcoin.conf"
    file = open(file_name, 'w')

    if(lndconfig['lndnetwork'] == 'testnet'):

        content = '''
        #Bitcoin config on the testnet network
        testnet=1
        # Run on a signet network
        #signet=0
        # Run a regression test network
        #regtest=1
        
        #bitcoin conf
        daemon=1
        txindex=1
        server=1
        
        # Options only for testnet
        [test]
          rpcuser='''+lndconfig['rpcuser']+'''
          rpcpassword='''+lndconfig['rpcpass']+'''
        
          rpcallowip=0.0.0.0/0
          rpcbind=0.0.0.0 # kubernetes cluster address
          rpcport=853
        
          externalip=192.168.123.252
          datadir='''+dir_name+'''
        
          minrelaytxfee=0.00000000
          incrementalrelayfee=0.00000010
        
          #for lnd connection:
          zmqpubrawblock=tcp://0.0.0.0:29088 
          # kubernetes cluster address
          zmqpubrawtx=tcp://0.0.0.0:29099 
          # kubernetes cluster address
        
          # allow neutrino mode
          #peerblockfilters=1
          #blockfilterindex=1
        
          # Optimizations
          dbcache=2000
          maxuploadtarget=5000
          maxconnections=60
          rpcthreads=256
          rpcworkqueue=8192
          rpctimeout=60
    '''
    else :
        content = '''
        #bitcoin config on the mainnet network
        daemon=1
        txindex=1
        server=1
        
        rpcuser='''+lndconfig['rpcuser']+'''
        rpcpassword='''+lndconfig['rpcpass']+'''
        
        rpcallowip=0.0.0.0/0
        rpcconnect=192.168.123.252
        #rpcbind=127.0.0.1
        # local DNS name (container name used in my Docker Compose file)
        rpcbind=0.0.0.0
        rpcport=853
        

        datadir='''+dir_name+'''
        # Connection options
        #bind=192.168.123.252
        externalip=192.243.215.232
        #externalip='''+lndconfig['rpchost']+'''.''' + lndconfig['alias'] + '''

        minrelaytxfee=0.00000000
        incrementalrelayfee=0.00000010
        
        #for lnd connection:
        zmqpubrawblock=tcp://0.0.0.0:29088
        zmqpubrawtx=tcp://0.0.0.0:29099
        
        # Optimizations
        dbcache=2000
        maxuploadtarget=5000
        maxconnections=60
        rpcthreads=256
        rpcworkqueue=8192
        rpctimeout=60
        '''
    file.write(content)
    file.close()
    return dir_name

def run_bitcoind(lndconfig):

    bcommand = "bitcoind -conf=/data/bitcoind/bitcoin.conf "
    print(bcommand)
    bchild = pexpect.spawn(bcommand)
    #save all logs from lncli pipe to child.log file in the same folder
    bchild.logfile =  open('/data/bitcoind/bitcoind.log', 'wb')
    result = bchild.expect([':', pexpect.EOF])
    time.sleep(10)
    if(lndconfig['lndnetwork']=='regtest'):
        #create wallet
        bchildw = pexpect.spawn("bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind createwallet aziz")
        print("create wallet")
        #save all logs from lncli pipe to child.log file in the same folder
        bchildw.logfile =  open('/data/bitcoind/bitcoindwallet.log', 'wb')
        result = bchild.expect([':', pexpect.EOF])
        time.sleep(10)

        bchild = pexpect.spawn("bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind -rpcwallet=aziz -generate 100")
        #save all logs from lncli pipe to child.log file in the same folder
        bchild.logfile =  open('/data/bitcoind/bitcoind.log', 'wb')
        print("new blocks generated");
        result = bchild.expect([':', pexpect.EOF])
        time.sleep(10)

        if os.path.exists('/data/v3/'):
            shutil.rmtree('/data/v3/')

        # bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind -getinfo
        # bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind createwallet aziz
        # bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind -rpcwallet=aziz -generate 1
        # bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind -rpcwallet=aziz -generate 20
        # bitcoin-cli -rpcport=853 -rpcuser=bitcoin -rpcpassword=bitcoind -rpcwallet=aziz getbalance "*" 1 true



