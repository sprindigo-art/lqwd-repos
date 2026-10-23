package com.lqwd.security.oauth2.service;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.lqwd.security.oauth2.model.enums.LNDNodeRole;
import com.lqwd.security.oauth2.model.security.LndNodeInfo;
import com.lqwd.security.oauth2.model.security.SharedLnds;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.repository.LndNodeInfoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class LndNodeInfoService {


    private JsonParser parser = new JsonParser();

    private final LndNodeInfoRepository lndNodeInfoRepository;



    public LndNodeInfo save(LndNodeInfo lndNodeInfo){
        if(lndNodeInfo.getCreatedDate() == null){
            Timestamp timestamp = new Timestamp(System.currentTimeMillis());
            lndNodeInfo.setCreatedDate(timestamp);
        }
        return lndNodeInfoRepository.save(lndNodeInfo);
    }

    public int countLndNodeInCreation(UUID userId){
        return lndNodeInfoRepository.countLndNodeInCreation(userId);
    }

    public int countLndNodeNotPaid(UUID userId){
        return lndNodeInfoRepository.countLndNodeNotPaid(userId);
    }

    public LndNodeInfo findById(Long id){
        Optional<LndNodeInfo> lndNodeInfo= lndNodeInfoRepository.findById(id);
        if(lndNodeInfo.isPresent()) return lndNodeInfo.get();
        return null;
    }

    public LndNodeInfo findByLndNodeName(String lndNodeName) {
        Optional<LndNodeInfo> lndNodeInfo = lndNodeInfoRepository.findByLndNodeName(lndNodeName);
        if(lndNodeInfo.isPresent()){
            return lndNodeInfo.get();
        }
        return null;
    }

    public LndNodeInfo getLndNodeByName(User_ user, String lndNodeName){
        Collection<LndNodeInfo> lndNodeInfos = user.getLndNodeInfos();

        LndNodeInfo lndNodeInfo = new LndNodeInfo();

        Iterator iterator = lndNodeInfos.iterator();
        while (iterator.hasNext()) {
            LndNodeInfo lndNodeInfo_a = (LndNodeInfo) iterator.next();
            if(lndNodeInfo_a.getLndnodename().equals(lndNodeName)){
                lndNodeInfo = lndNodeInfo_a;
            }
        }

        return lndNodeInfo;
    }
    public List<LndNodeInfo> findByUser(UUID id){
        return lndNodeInfoRepository.findByUser(id);
    }


    public LndNodeInfo findByLndnodenameAndUser(String lndNodeName,User_ user){

        Optional<LndNodeInfo> lndNodeInfo = lndNodeInfoRepository.findByLndnodenameAndUser(lndNodeName,user.getId());

        return  lndNodeInfo.orElse(null);

    }

    public void updateVersionFromKafkaMessage(String message){

        JsonObject res = parser.parse(message).getAsJsonObject();

        LndNodeInfo info = findByLndNodeName(res.get("nodeName").getAsString());

        if(info == null)
            return;

        info.setLndVersion(res.get("lndVersion").getAsString());
        info.setScriptVersion(res.get("scriptVersion").getAsString());

        save(info);
    }

    public LndNodeInfo getLndNodeByIdAndUserId(Long lndNodeId, UUID userId) {
        Optional<LndNodeInfo> lndNodeInfo = lndNodeInfoRepository.findByLndnodeIdAndUser(lndNodeId,userId);
        return  lndNodeInfo.orElse(null);
    }
}
