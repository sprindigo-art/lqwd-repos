package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.controller.LndNodeController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

public class LndNodeInfo {

    private String version;

    private String commit_hash;

    private String identity_pubkey;

    private String alias;

    private Integer num_pending_channels;

    private Integer num_active_channels;

    private Integer num_inactive_channels;

    private Integer num_peers;

    private Integer block_height;

    private String block_hash;

    private static Logger logger = LoggerFactory.getLogger(LndNodeInfo.class);

    public String getVersion() {
        return version;
    }

    public void setVersion(String version) {
        this.version = version;
    }

    public String getCommit_hash() {
        return commit_hash;
    }

    public void setCommit_hash(String commit_hash) {
        this.commit_hash = commit_hash;
    }

    public String getIdentity_pubkey() {
        return identity_pubkey;
    }

    public void setIdentity_pubkey(String identity_pubkey) {
        this.identity_pubkey = identity_pubkey;
    }

    public String getAlias() {
        return alias;
    }

    public void setAlias(String alias) {
        this.alias = alias;
    }

    public Integer getNum_pending_channels() {
        return num_pending_channels;
    }

    public void setNum_pending_channels(Integer num_pending_channels) {
        this.num_pending_channels = num_pending_channels;
    }

    public Integer getNum_active_channels() {
        return num_active_channels;
    }

    public void setNum_active_channels(Integer num_active_channels) {
        this.num_active_channels = num_active_channels;
    }

    public Integer getNum_inactive_channels() {
        return num_inactive_channels;
    }

    public void setNum_inactive_channels(Integer num_inactive_channels) {
        this.num_inactive_channels = num_inactive_channels;
    }

    public Integer getNum_peers() {
        return num_peers;
    }

    public void setNum_peers(Integer num_peers) {
        this.num_peers = num_peers;
    }

    public Integer getBlock_height() {
        return block_height;
    }

    public void setBlock_height(Integer block_height) {
        this.block_height = block_height;
    }

    public String getBlock_hash() {
        return block_hash;
    }

    public void setBlock_hash(String block_hash) {
        this.block_hash = block_hash;
    }

    public LndNodeInfo mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        try {
            lndNodeInfo = mapper.readValue(content, LndNodeInfo.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
            return null;
        }
        return lndNodeInfo;
    }

    @Override
    public String toString(){
        return "\nLND Node Info\n--------\n"
                + "Version: " + this.getVersion() + "\n"
                + "Commit Hash: " + this.getCommit_hash() + "\n"
                + "Identity Pubkey: " + this.getIdentity_pubkey() + "\n"
                + "Alias: " + this.getAlias() + "\n"
                + "Number of Pending Channels: " + this.getNum_pending_channels() + "\n"
                + "Number of Active Channels: " + this.getNum_active_channels() + "\n"
                + "Number of Inactive Channels: " + this.getNum_inactive_channels() + "\n"
                + "Number of Peers: " + this.getNum_peers() + "\n"
                + "Block Height: " + this.getBlock_height() + "\n"
                + "Block Hash: " + this.getBlock_hash() + "\n";
    }
}