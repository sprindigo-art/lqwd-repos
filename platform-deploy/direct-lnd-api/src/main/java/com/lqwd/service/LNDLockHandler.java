package com.lqwd.service;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.entities.LndCreationStatusLog;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

@Service
@RequiredArgsConstructor
public class LNDLockHandler {

    private static final Logger logger = LoggerFactory.getLogger(LNDLockHandler.class);


    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final KafkaMessageSender kafkaMessageSender;


    public void handleLNDEvent(String nodeId, String status) {

        String token = accessTokenServiceHelper.getClientAccessToken();

        MainResponse response = httpClientToken.lndNodeInfo(token, nodeId, "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200) {
            logger.error("Cannot retrieve info for node {}", nodeId);
            return;
        }

        JSONObject jsonData = new JSONObject(response.getObject());
        String ownerEmail = jsonData.getString("ownerEmail");

        HashMap<String, String> parts = new HashMap<>();
        parts.put("token", token);
        parts.put("lndNodeName", nodeId);
        parts.put("status", status);

        httpClientToken.lndNodeUpdate(token, parts,
                "/lndnode/update", "LndNodeInfo");

        sendWalletsNeedUnlockEmail(ownerEmail, nodeId);


    }

    public void sendWalletsNeedUnlockEmail(String email, String node) {
        StringBuilder builder = new StringBuilder();

        builder.append("One your nodes cannot start. You are required to provide your wallet password and passphrase to unlock your nodes wallet.");
        builder.append("<br /><b>Node</b>:")
                .append(node);


        EmailBody emailBody = new EmailBody();
        emailBody.setBody(builder.toString());
        emailBody.setSubject("Your LQWD Node Wallet needs to be unlocked");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();
        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("Info");
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);
        receivers.add(receiver);

        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);

    }
}
