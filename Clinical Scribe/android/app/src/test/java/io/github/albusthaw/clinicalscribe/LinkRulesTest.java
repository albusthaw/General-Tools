package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LinkRulesTest {

    private static final String APP = "io.github.albusthaw.clinicalscribe://";

    @Test
    public void acceptsAConnectLinkWithASecureServer() {
        assertTrue(LinkRules.isAccepted(APP + "connect?server=https%3A%2F%2Fabc.supabase.co"));
        assertTrue(LinkRules.isAccepted(APP + "connect?server=https://scribe.example.org/"));
    }

    @Test
    public void refusesConnectLinksWithoutASecureServer() {
        assertFalse(LinkRules.isAccepted(APP + "connect"));
        assertFalse(LinkRules.isAccepted(APP + "connect?server="));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=http%3A%2F%2Fabc.supabase.co"));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=javascript%3Aalert(1)"));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=https%3A%2F%2Fa.example%20b"));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=https://" + "a".repeat(600) + ".example"));
    }

    @Test
    public void acceptsASignInReturnWithACode() {
        assertTrue(LinkRules.isAccepted(APP + "auth?code=abcDEF12-_xyz"));
        assertTrue(LinkRules.isAccepted(APP + "auth?error=access_denied&error_description=Cancelled"));
    }

    @Test
    public void refusesSignInReturnsWithAStrangeCode() {
        assertFalse(LinkRules.isAccepted(APP + "auth"));
        assertFalse(LinkRules.isAccepted(APP + "auth?code=short"));
        assertFalse(LinkRules.isAccepted(APP + "auth?code=abc%3Cscript%3E12345"));
        assertFalse(LinkRules.isAccepted(APP + "auth?code=" + "a".repeat(201)));
    }

    @Test
    public void refusesOtherLinks() {
        assertFalse(LinkRules.isAccepted(null));
        assertFalse(LinkRules.isAccepted(""));
        assertFalse(LinkRules.isAccepted("https://example.org/connect?server=https://a.example"));
        assertFalse(LinkRules.isAccepted("other.app://connect?server=https://a.example"));
        assertFalse(LinkRules.isAccepted(APP + "settings?server=https://a.example"));
        assertFalse(LinkRules.isAccepted("io.github.albusthaw.clinicalscribe://user@connect?server=https://a.example"));
        assertFalse(LinkRules.isAccepted("io.github.albusthaw.clinicalscribe://connect:99?server=https://a.example"));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=https://a.example&" + "x".repeat(2100)));
        assertFalse(LinkRules.isAccepted(APP + "connect?server=%zz"));
    }

    @Test
    public void readsOneDecodedParameter() {
        assertEquals("https://a.example/", LinkRules.param("x=1&server=https%3A%2F%2Fa.example%2F", "server"));
        assertEquals("", LinkRules.param("server", "server"));
        assertNull(LinkRules.param("x=1", "server"));
        assertNull(LinkRules.param(null, "server"));
        assertNull(LinkRules.param("server=%zz", "server"));
    }
}
