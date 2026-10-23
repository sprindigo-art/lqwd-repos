/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestGetUserNodesMyChannels() {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lndnode/getlist`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        },
    });
}

export function requestGetNodeChannelsByNode(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    let params = "&types=";
    if (payload.filterOptions == null) {
        params = params + "INACTIVE_CHANNEL,ACTIVE_CHANNEL,PENDING_OPEN_CHANNEL,OPEN_CHANNEL";
    } else {
        for (let i = 0; i < payload.filterOptions.length; i++) {
            let filter = payload.filterOptions[i];
            if (filter.key === "all" && filter.selected) {
                params = params + "INACTIVE_CHANNEL,ACTIVE_CHANNEL,PENDING_OPEN_CHANNEL,OPEN_CHANNEL";
            } else {
                if (filter.key === "active" && filter.selected) {
                    params = params + "ACTIVE_CHANNEL,OPEN_CHANNEL,";
                }
                if (filter.key === "inactive" && filter.selected) {
                    params = params + "INACTIVE_CHANNEL,";
                }
                if (filter.key === "pending" && filter.selected) {
                    params = params + "PENDING_OPEN_CHANNEL,";
                }
            }
        }
    }

    if (params === "&types=") {
        params = params + "INACTIVE_CHANNEL,ACTIVE_CHANNEL,PENDING_OPEN_CHANNEL,OPEN_CHANNEL";
    }

    if (payload.channelTable == null) {
        payload.channelTable = {
            pageNumber: 0,
            pageSize: 10,
        }
    }

    let searchParams = "";

    if (payload.search != null && payload.search != "") {
        searchParams = "&query="+payload.search
    }

    return request(`${baseURL}/api/v1/user_lnd_channels?lndname=${payload.nodeName}&pageNumber=${payload.channelTable.pageNumber}&pageSize=${payload.channelTable.pageSize}${params}${searchParams}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
    });
}

export function requestGetClosedChannels(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/api/v1/user_lnd_channels?lndname=${payload.nodeName}&types=FULLY_RESOLVED_CHANNEL,CLOSED_CHANNEL&pageNumber=${payload.pageNumber}&pageSize=${payload.pageSize}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
    });
}

export function requestConnectToPeer(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { localNode, remoteNode } = payload;

    let requestBody = {
        "addr": {
            "pubkey": remoteNode.remotePubkey,
            "host": remoteNode.remoteHostname + ':' + remoteNode.remotePort
        },
        "perm": true,
        "timeout": "30",
    }

    return request(`${baseURL}/lnd/v1/peers`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "Accept": "application/json",
                "lndname": localNode,
            },
            json: true,
            body: JSON.stringify(requestBody),
        },
        false,
        false
    );
}

export function requestCreateChannel(payload) {

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { channelData, password, passphrase } = payload;

    let requestBody = {
        "lndname": channelData.localNode,
        "pubKey": channelData.remotePubkey,
        "nodeAddress": channelData.localHostname,
        "remoteAddress": channelData.remoteHostname + ":" + channelData.remotePort,
        "capacity": channelData.amount,
        "satPerVByte": channelData.satPerVByte,
        "min_htlc_msat": channelData.minHtlc,
        "privateChannel": channelData.private,
        "password": password,
        ...(passphrase != undefined && { passphrase: passphrase })
    };

    return request(`${baseURL}/api/v1/channel/open_channel`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify(requestBody)
    }, false, false);
}

export function requestCloseChannel(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { channelData, force, password } = payload;

    return request(`${baseURL}/lnd/v1/channels/${channelData.channelPoint.split(":")[0]}/${channelData.channelPoint.split(":")[1]}` + (force ? "?force=true" : ""), {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "Accept": "application/json",
                "lndname": channelData.nodeName,
                "passphrase": password,
            },
        },
        true,
        false,
    );
}

export function requestSyncChannels(payload){
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/api/v1/sync_channels`, {
          method: 'POST',
          headers: {
              Authorization: `Bearer ${token}`,
              "content-type": "application/x-www-form-urlencoded",
              "Accept": "application/json",
          },
          body: new URLSearchParams({
              lndname: payload.nodeName,
          }),
      },false, false,
    );
}