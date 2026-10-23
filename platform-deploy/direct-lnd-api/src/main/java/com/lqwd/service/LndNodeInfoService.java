package com.lqwd.service;

import com.lqwd.exceptions.NotFoundException;
import com.lqwd.model.BatchNodeInfo;
import com.lqwd.model.entities.LndNodeDetail;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.repository.LndNodeInfoRepository;
import lombok.RequiredArgsConstructor;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LndNodeInfoService {

    private static final Logger logger = LoggerFactory.getLogger(LndNodeInfoService.class);

    private final LndNodeInfoRepository lndNodeInfoRepository;


    private LndNodeDetail createInfo(LndNodeDetail info){
        return lndNodeInfoRepository.save(info);
    }


    public void createInfoFromBatchMonitoring(List<BatchNodeInfo> batch){

        Map<String, BatchNodeInfo> latestInfoHash = new HashMap<>();
        List<LndNodeDetail> detailsToSave = new ArrayList<>();

        for(BatchNodeInfo b : batch){
            if(latestInfoHash.get(b.getNode()) == null){
                latestInfoHash.put(b.getNode(), b);
            }else{
                if(b.getTimeStamp() > latestInfoHash.get(b.getNode()).getTimeStamp()){
                    latestInfoHash.put(b.getNode(), b);
                }
            }
        }

        for(BatchNodeInfo b : latestInfoHash.values()){
            LndNodeDetail nodeInfo = new LndNodeDetail();
            nodeInfo.setNodeName(b.getNode());
            nodeInfo.setUserId(b.getUserId());
            nodeInfo.setVersion(b.getInfo().getString("version"));
            nodeInfo.setCommit_hash(b.getInfo().getString("commit_hash"));
            nodeInfo.setIdentity_pubkey(b.getInfo().getString("identity_pubkey"));
            nodeInfo.setColor(b.getInfo().getString("color"));
            nodeInfo.setAlias(b.getInfo().getString("alias"));
            nodeInfo.setNum_pending_channels(b.getInfo().getInt("num_pending_channels"));
            nodeInfo.setNum_active_channels(b.getInfo().getInt("num_active_channels"));
            nodeInfo.setNum_inactive_channels(b.getInfo().getInt("num_inactive_channels"));
            nodeInfo.setNum_peers(b.getInfo().getInt("num_peers"));
            nodeInfo.setBlock_height(b.getInfo().getInt("block_height"));
            nodeInfo.setBlock_hash(b.getInfo().getString("block_hash"));
            nodeInfo.setBest_header_timestamp(b.getInfo().getString("best_header_timestamp"));
            nodeInfo.setSynced_to_chain(b.getInfo().getBoolean("synced_to_chain"));
            nodeInfo.setSynced_to_graph(b.getInfo().getBoolean("synced_to_graph"));

            JSONArray uris = b.getInfo().getJSONArray("uris");
            List<String> uriList = new ArrayList<>();

            JSONArray chains = b.getInfo().getJSONArray("chains");
            List<String> chainList = new ArrayList<>();

            for(int i = 0; i < uris.length(); i++){
                uriList.add(uris.get(i).toString());
            }

            for(int i = 0; i < chains.length(); i++){
                chainList.add(chains.getJSONObject(i).getString("chain") + "-"
                        + chains.getJSONObject(i).getString("network"));
            }

            nodeInfo.setUris(String.join(",", uriList));
            nodeInfo.setChains(String.join(",", chainList));

            detailsToSave.add(nodeInfo);
        }

        lndNodeInfoRepository.saveAll(detailsToSave);
    }

    public LndNodeDetail createInfoFromMonitoring(JSONObject info, String nodeName, String userId){

        LndNodeDetail nodeInfo = getNodeInfoByNodeName(nodeName)
                .orElse(new LndNodeDetail());

        nodeInfo.setNodeName(nodeName);
        nodeInfo.setUserId(userId);
        nodeInfo.setVersion(info.getString("version"));
        nodeInfo.setCommit_hash(info.getString("commit_hash"));
        nodeInfo.setIdentity_pubkey(info.getString("identity_pubkey"));
        nodeInfo.setColor(info.getString("color"));
        nodeInfo.setAlias(info.getString("alias"));
        nodeInfo.setNum_pending_channels(info.getInt("num_pending_channels"));
        nodeInfo.setNum_active_channels(info.getInt("num_active_channels"));
        nodeInfo.setNum_inactive_channels(info.getInt("num_inactive_channels"));
        nodeInfo.setNum_peers(info.getInt("num_peers"));
        nodeInfo.setBlock_height(info.getInt("block_height"));
        nodeInfo.setBlock_hash(info.getString("block_hash"));
        nodeInfo.setBest_header_timestamp(info.getString("best_header_timestamp"));
        nodeInfo.setSynced_to_chain(info.getBoolean("synced_to_chain"));
        nodeInfo.setSynced_to_graph(info.getBoolean("synced_to_graph"));

        JSONArray uris = info.getJSONArray("uris");
        List<String> uriList = new ArrayList<>();

        JSONArray chains = info.getJSONArray("chains");
        List<String> chainList = new ArrayList<>();

        for(int i = 0; i < uris.length(); i++){
            uriList.add(uris.get(i).toString());
        }

        for(int i = 0; i < chains.length(); i++){
            chainList.add(chains.getJSONObject(i).getString("chain") + "-"
                    + chains.getJSONObject(i).getString("network"));
        }

        nodeInfo.setUris(String.join(",", uriList));
        nodeInfo.setChains(String.join(",", chainList));

        return createInfo(nodeInfo);
    }

    public Optional<LndNodeDetail> getNodeInfoByNodeName(String nodeName){
        return lndNodeInfoRepository.findByNodeName(nodeName);
    }

    private ApiResponse<LndNodeDetail> getNodeInfoByNodeNameApi(String nodeName){
        LndNodeDetail info = lndNodeInfoRepository.findByNodeName(nodeName).orElseThrow(
                () -> new NotFoundException(404, "No info found for the provided node")
        );

        return new ApiResponse<>(info, "Node info retrieved successfully");
    }

}