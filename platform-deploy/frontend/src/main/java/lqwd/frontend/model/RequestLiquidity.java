package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Column;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.io.IOException;
import java.util.Date;

public class RequestLiquidity {
    private static Logger logger = LoggerFactory.getLogger(ApiKey.class);
    private long id;
    private int amt;
    private String userId;
    private Long invoiceId;
    private Long channelId;
    private Boolean paid = false;
    private String pubkey;
    private String ipAddress;
    private int durationInWeeks;
    private Date channelExpiryDate;
    private Boolean expired = false;
    private Date dateCreated;
    private Date dateModified;
    private String refNo;


    public String getPubkey() {
        return pubkey;
    }

    public Date getDateCreated() {
        return dateCreated;
    }

    public void setDateModified(Date dateModified) {
        this.dateModified = dateModified;
    }

    public void setDateCreated(Date dateCreated) {
        this.dateCreated = dateCreated;
    }

    public void setExpired(Boolean expired) {
        this.expired = expired;
    }

    public void setChannelExpiryDate(Date channelExpiryDate) {
        this.channelExpiryDate = channelExpiryDate;
    }

    public void setPaid(Boolean paid) {
        this.paid = paid;
    }

    public void setChannelId(Long channelId) {
        this.channelId = channelId;
    }

    public void setInvoiceId(Long invoiceId) {
        this.invoiceId = invoiceId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public Boolean getExpired() {
        return expired;
    }

    public void setId(long id) {
        this.id = id;
    }

    public Date getChannelExpiryDate() {
        return channelExpiryDate;
    }

    public Boolean getPaid() {
        return paid;
    }

    public Long getChannelId() {
        return channelId;
    }

    public Long getInvoiceId() {
        return invoiceId;
    }

    public String getUserId() {
        return userId;
    }

    public int getDurationInWeeks() {
        return durationInWeeks;
    }

    public long getId() {
        return id;
    }

    public RequestLiquidity() {
    }

    public void setRefNo(String refNo) {
        this.refNo = refNo;
    }

    public void setAmt(int amount) {
        this.amt = amount;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = ipAddress;
    }

    public void setPubkey(String pubkey) {
        this.pubkey = pubkey;
    }

    public void setDurationInWeeks(int numberOfWeeks) {
        this.durationInWeeks = numberOfWeeks;
    }

    public String getRefNo() {
        return refNo;
    }

    public int getAmt() {
        return amt;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public RequestLiquidity mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        RequestLiquidity requestLiquidity = new RequestLiquidity();
        try {

            requestLiquidity = mapper.readValue(content, RequestLiquidity.class);

        } catch (IOException e) {
            logger.error(e.getMessage());
        }
        return requestLiquidity;
    }
    @Override
    public String toString() {
        return "RequestLiquidity{" +
                "id=" + id +
                ", amt=" + amt +
                ", durationInWeeks=" + durationInWeeks +
                ", pubkey='" + pubkey + '\'' +
                ", ipAddress='" + ipAddress + '\'' +
                ", refNo='" + refNo + '\'' +
                ", userId='" + userId + '\'' +
                ", invoiceId=" + invoiceId +
                ", channelId=" + channelId +
                ", paid=" + paid +
                ", channelExpiryDate=" + channelExpiryDate +
                ", expired=" + expired +
                ", dateCreated=" + dateCreated +
                ", dateModified=" + dateModified +
                '}';
    }
}
