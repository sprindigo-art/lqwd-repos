package com.lqwd.security.oauth2.service;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.security.oauth2.model.enums.LNDNodeRole;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import com.lqwd.security.oauth2.model.response.LndNodeResponse;
import com.lqwd.security.oauth2.model.response.SharedUsersPermission;
import com.lqwd.security.oauth2.model.security.*;
import com.lqwd.security.oauth2.repository.SharedLndsRepository;
import com.lqwd.security.oauth2.repository.SharedLndsRepositoryForList;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.text.MessageFormat;
import java.util.*;

@Service
@RequiredArgsConstructor
public class SharedLndsService {
    private final SharedLndsRepository sharedLndsRepository;

    private final SharedLndsRepositoryForList sharedLndsRepositoryForList;

    private final EmailSenderService emailSenderService;

    private final LndNodeInfoService lndNodeInfoService;

    private final UserService userService;

    private static final Logger logger = LoggerFactory.getLogger(SharedLndsService.class);

    @Value("${app.mail_confirmation_link}")
    private String mailConfirmationLink;

    @Value("${app.send_mail_from}")
    private String sendEmailFrom;

    public SharedLnds save(SharedLnds sharedLnds) throws IOException {

        this.deleteSharedLnd(sharedLnds.getUser().getId().toString(), sharedLnds.getLndNodeInfo().getId().toString());
        sharedLnds = sharedLndsRepository.save(sharedLnds);

        this.sendSharedEmail(sharedLnds.getUser().getEmail(), sharedLnds.getRole().getName(), sharedLnds.getLndNodeInfo().getLndnodename(),
                sharedLnds.getLndNodeInfo().getUser().getUsername() );

        return sharedLnds;
    }

    private void sendSharedEmail(String recipientEmail, String role, String node, String user) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/welcome-shared-lnd-template.html");

        String template = org.apache.commons.io.IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String modified = MessageFormat.format(template, role, node, user);

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject(String.format("Welcome to LQwD! You have been added as %s to new LND node", role));

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);


        emailBody.setSender(sender);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("");
        receiver.setEmail(recipientEmail);
        receiver.setRecipientType(RecipientType.TO);


        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setAttachments(new ArrayList<>());

        emailSenderService.sendEmail(emailBody);

    }
    public ArrayList<LndNodeResponse> getSharedLndNodeInfos(User_ user) {
        ArrayList<LndNodeResponse> lndNodeResponsesArrayList = new ArrayList<>();
        try {
            Collection<SharedLndsForList> sharedLndsForListCollection = sharedLndsRepositoryForList.findAllByUser_id(user.getId());
            logger.info("Shared node controller user id select " + user.getId() );
            logger.info("number of shared nodes : " + sharedLndsForListCollection.size());
            Iterator iterator = sharedLndsForListCollection.iterator();


            while (iterator.hasNext()) {
                SharedLndsForList sharedLndsForList = (SharedLndsForList) iterator.next();
                logger.info("Lnd node line 102");
                LndNodeInfo  lndNodeInfo = lndNodeInfoService.findById(sharedLndsForList.getLndNodeInfoId());
                logger.info("Lnd node line 104");
                if (!lndNodeInfo.getStatus().equals(LNDNodeStatus.DELETED)) {
                    logger.info("Lnd node line 106");
                    lndNodeInfo.setLndNodeRole(this.getLndNodeRole(lndNodeInfo, user));

                    logger.info("Shared Lnd Node Info Controller  role founded " );

                    LndNodeResponse lndNodeResponse = new LndNodeResponse(lndNodeInfo);
                    logger.info("Lnd node line 112" + lndNodeResponse.getNodeRole());
                    lndNodeResponsesArrayList.add(lndNodeResponse);
                }

            }
            logger.info("Shared Lnd Node Info Controller  total number of Lnd node Response is " + lndNodeResponsesArrayList.size() );
            return lndNodeResponsesArrayList;
        } catch (Exception e){
            logger.error(" Shared Lnd node Infos exception :---------------: ");
            logger.error(e.getMessage());
            return lndNodeResponsesArrayList;
        }
    }

    public ArrayList<SharedUsersPermission> getSharedUsersList(User_ user) {

        Collection<LndNodeInfo> lndNodeInfos = user.getLndNodeInfos();

        ArrayList<SharedUsersPermission> sharedUsersPermissions = new ArrayList<>();
        Iterator iterator = lndNodeInfos.iterator();
        while (iterator.hasNext()) {
            LndNodeInfo lndNodeInfo = (LndNodeInfo) iterator.next();
            if (!lndNodeInfo.getStatus().equals(LNDNodeStatus.DELETED)) {


                Collection<SharedLnds> sharedLnds = sharedLndsRepository.findAllByNode_idActive(lndNodeInfo.getId());
                Iterator iterator_share = sharedLnds.iterator();
                while (iterator_share.hasNext()) {
                    SharedLnds sharedLnd = (SharedLnds) iterator_share.next();

                    User_ sharedUser = userService.findById(sharedLnd.getUser().getId().toString());

                    SharedUsersPermission sharedUsersPermission = new SharedUsersPermission();
                    sharedUsersPermission.setNodeName(lndNodeInfo.getLndnodename());
                    sharedUsersPermission.setAlias(lndNodeInfo.getNodeAlias());
                    sharedUsersPermission.setRole(sharedLnd.getRole());
                    sharedUsersPermission.setEmail(sharedUser.getEmail());
                    sharedUsersPermission.setUserFirstLastName(sharedUser.getUserDetails().getFirstName() + " " +sharedUser.getUserDetails().getLastName());

                    sharedUsersPermissions.add(sharedUsersPermission);
                }

            }

        }
        return sharedUsersPermissions;
    }

    public ArrayList<SharedUsersPermission> getSharedUsersListHistory(User_ user) {

        Collection<LndNodeInfo> lndNodeInfos = user.getLndNodeInfos();

        ArrayList<SharedUsersPermission> sharedUsersPermissions = new ArrayList<>();
        Iterator iterator = lndNodeInfos.iterator();
        while (iterator.hasNext()) {
            LndNodeInfo lndNodeInfo = (LndNodeInfo) iterator.next();
            if (!lndNodeInfo.getStatus().equals(LNDNodeStatus.DELETED)) {


                Collection<SharedLnds> sharedLnds = sharedLndsRepository.findAllByNode_id(lndNodeInfo.getId());
                Iterator iterator_share = sharedLnds.iterator();
                while (iterator_share.hasNext()) {
                    SharedLnds sharedLnd = (SharedLnds) iterator.next();

                    User_ sharedUser = userService.findById(sharedLnd.getUser().getId().toString());

                    SharedUsersPermission sharedUsersPermission = new SharedUsersPermission();
                    sharedUsersPermission.setNodeName(lndNodeInfo.getLndnodename());
                    sharedUsersPermission.setAlias(lndNodeInfo.getNodeAlias());
                    sharedUsersPermission.setRole(sharedLnd.getRole());
                    sharedUsersPermission.setEmail(sharedUser.getEmail());
                    sharedUsersPermission.setUserFirstLastName(sharedUser.getUserDetails().getFirstName() + " " +sharedUser.getUserDetails().getLastName());

                    sharedUsersPermissions.add(sharedUsersPermission);
                }

            }

        }
        return sharedUsersPermissions;
    }

    public boolean deleteSharedLnd(String newUser_id, String lndNode_id) {

        Timestamp updated_at = new Timestamp(System.currentTimeMillis());


        sharedLndsRepository.updateStatus(UUID.fromString(newUser_id), Long.parseLong(lndNode_id), updated_at);

        return true;
    }

    public SharedLnds getSharedLndNodeInfo(UUID user_id, Long node_id) {
        Optional<SharedLnds> sharedLnds = sharedLndsRepository.findByNode_idUser_id(user_id, node_id);
        if (sharedLnds != null) return sharedLnds.get();
        else return null;
    }

    public String getLndNodeRole(LndNodeInfo lndNodeInfo, User_ user){
        if (user.getId().equals(lndNodeInfo.getUser().getId())){
            return LNDNodeRole.OWNER.toString();
        } else {
            SharedLnds sharedLnds = this.getSharedLndNodeInfo(user.getId(), lndNodeInfo.getId());
            if(sharedLnds != null) {
                if (sharedLnds.getRole().getName().toString().equals(LNDNodeRole.ADMIN.toString())) {
                    return LNDNodeRole.ADMIN.toString();
                } else if (sharedLnds.getRole().getName().toString().equals(LNDNodeRole.SUPERVISOR.toString())) {
                    return LNDNodeRole.SUPERVISOR.toString();
                } else if (sharedLnds.getRole().getName().toString().equals(LNDNodeRole.AUDITOR.toString())) {
                    return LNDNodeRole.AUDITOR.toString();
                }
            }
        }
        return null;
    }


    public LndNodeInfo getSharedLndNodeInfoByUserLndNodeName(User_ user, String lndNodeName) {

        try {
            Collection<SharedLndsForList> sharedLndsCollections = sharedLndsRepositoryForList.findAllByUser_id(user.getId());
            Iterator iterator = sharedLndsCollections.iterator();


            while (iterator.hasNext()) {
                SharedLndsForList sharedLndsForList = (SharedLndsForList) iterator.next();
                LndNodeInfo lndNodeInfo = lndNodeInfoService.findById(sharedLndsForList.getLndNodeInfoId());
                if(lndNodeInfo.getLndnodename().equals(lndNodeName)){
                    return lndNodeInfo;
                }
            }
            return null;

        } catch (Exception e) {
            logger.error(e.getMessage());
            return null;
        }
    }

    public void deleteSharedLndByLndName(Long lndNode_id) {
        Timestamp updated_at = new Timestamp(System.currentTimeMillis());
        sharedLndsRepository.updateStatusByLndNodeId(lndNode_id, updated_at);
    }
}
