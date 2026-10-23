package com.lqwd.model.enums;

public enum LndNetwork {
    MAINNET ("mainnet","lnd"),
    TESTNET ("testnet","tlnd"),
    REGTEST ("regtest","slnd");

    private final String name;
    private final String prefix;


    LndNetwork(String name, String prefix) {
        this.name = name;
        this.prefix = prefix;
    }

    public String getPrefix(){
        return prefix;
    }
    public String toString(){
        return this.name;
    }

    public static LndNetwork getNetworkFromPrefix(String prefix){

        if(prefix.equals(MAINNET.prefix)){
            return MAINNET;
        }else  if(prefix.equals(TESTNET.prefix)){
            return TESTNET;
        }else {
            return REGTEST;
        }

    }
}
