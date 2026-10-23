package lqwd.frontend.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Column;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.util.ArrayList;
import java.util.Date;

public class LiquidityInvoiceType {
    private static Logger logger = LoggerFactory.getLogger(Invoice.class);
    private Long id;
    private String amt;
    private String hashStr;
    private String paymentRequest;
    private String paymentAddress;
    private String addIndex;
    private String nodeName;
    private String settledIndex;
    private Boolean paid = false;
    private Date dateCreated;
    private Date dateModified;
    private Date paymentDate;

    public void setId(Long id) {
        this.id = id;
    }
    public Long getId() {
        return id;
    }

    public void setPaymentDate(Date paymentDate) {
        this.paymentDate = paymentDate;
    }

    public void setDateModified(Date dateModified) {
        this.dateModified = dateModified;
    }

    public void setDateCreated(Date dateCreated) {
        this.dateCreated = dateCreated;
    }

    public void setPaid(Boolean paid) {
        this.paid = paid;
    }

    public void setSettledIndex(String settledIndex) {
        this.settledIndex = settledIndex;
    }

    public void setNodeName(String nodeName) {
        this.nodeName = nodeName;
    }

    public void setAddIndex(String addIndex) {
        this.addIndex = addIndex;
    }

    public void setPaymentAddress(String paymentAddress) {
        this.paymentAddress = paymentAddress;
    }

    public void setPaymentRequest(String paymentRequest) {
        this.paymentRequest = paymentRequest;
    }

    public void setHashStr(String hashStr) {
        this.hashStr = hashStr;
    }

    public void setAmt(String amt) {
        this.amt = amt;
    }

    public Date getPaymentDate() {
        return paymentDate;
    }

    public Date getDateModified() {
        return dateModified;
    }

    public Date getDateCreated() {
        return dateCreated;
    }

    public Boolean getPaid() {
        return paid;
    }

    public String getSettledIndex() {
        return settledIndex;
    }

    public String getNodeName() {
        return nodeName;
    }

    public String getAddIndex() {
        return addIndex;
    }

    public String getPaymentAddress() {
        return paymentAddress;
    }

    public String getPaymentRequest() {
        return paymentRequest;
    }

    @Override
    public String toString() {
        return "LiquidityInvoiceType{" +
                "id=" + id +
                ", amt='" + amt + '\'' +
                ", hashStr='" + hashStr + '\'' +
                ", paymentRequest='" + paymentRequest + '\'' +
                ", paymentAddress='" + paymentAddress + '\'' +
                ", addIndex='" + addIndex + '\'' +
                ", nodeName='" + nodeName + '\'' +
                ", settledIndex='" + settledIndex + '\'' +
                ", paid=" + paid +
                ", dateCreated=" + dateCreated +
                ", dateModified=" + dateModified +
                ", paymentDate=" + paymentDate +
                '}';
    }

    public String getHashStr() {
        return hashStr;
    }

    public String getAmt() {
        return amt;
    }
    public ArrayList<LiquidityInvoiceType> mapInvoiceLiquidityList(String content)  {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {

            ArrayList<LiquidityInvoiceType> invoices = new ArrayList<>();

        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("data")) {
            JSONArray jsonArray = jsonObject.getJSONArray("data");
            for (int i = 0; i < jsonArray.length(); i++) {
                LiquidityInvoiceType invoice = mapper.readValue(jsonArray.getJSONObject(i).toString(), LiquidityInvoiceType.class);
                invoices.add(invoice);
            }

            return  invoices;
        }else {
            return null;
        }
    } catch (JsonProcessingException jsonMappingException) {
        logger.error(jsonMappingException.toString());
        return null;
    }
    }
}
